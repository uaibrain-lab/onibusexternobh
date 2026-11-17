# P6 — Precisão e confiabilidade do planejador (17/11/2026)

**Branch:** `feat/externo-p6-precisao-roteador-20261117` (base P5). **Ambiente:** desenvolvimento, sem deploy ou merge na produção.

## Mudanças entregues

1. **Busca por viagens efetivas, sem ranking arbitrário de linhas.** O índice invertido de pontos para `trip_id` impede examinar milhões de registros irrelevantes em cada rodada. A P5 cortava silenciosamente após 135 linhas; a P6 tenta todas as linhas relevantes, com estatísticas do número de candidatos.
2. **GTFS V2 com regras oficiais.** O gerador mantém `pickup_type` e `drop_off_type` por parada. Embarque/desembarque proibido ou sujeito a acordo não é recomendado. Horários após 24h recebem suporte explícito por dia de serviço e limite de validade.
3. **Critérios e temporalidade.** Consulta adiante e retroativa, até 3 embarques, limites temporais e verificação adicional de continuidade cronológica e dos IDs de paradas; rotas que falham nessas verificações são rejeitadas.
4. **Rede a pé por OpenStreetMap.** `scripts/build_walking.py` usa `osmium` para gerar `catalog/walk-network.json.gz` sobre vias transitáveis a pé, com `oneway:foot`, vias restritas e componentes conectados. `transit/walking.py` usa A* com distância geográfica como heurística inferior. Sem caminho conectado, não sugere baldeação atravessando uma barreira. O acesso do endereço/ponto ao primeiro nó do OSM continua aproximado e explicitamente marcado como não validado.
5. **Falhas são explícitas.** Sem grafo OSM, a interface avisa que a caminhada é geométrica. Com grafo, a interface usa linhas verdes segmentadas para caminhada e mantém o itinerário do ônibus como traçado meramente esquemático. Respostas limitadas são `partial`, e `GET /externo/api/plan/status` informa o estado dos dados e as limitações de GPS e metrô.

## Números verificados

- GTFS da PBH processado em 17/11/2026: 326 linhas, 113.692 viagens, 6.691.004 stop_times, 9.925 paradas.
- Validade publicada no GTFS até 31/12/2026; viagens com horários após meia-noite respeitam o dia de serviço.
- Antes da rede OSM e da otimização: consulta P5 frequentemente parcial com 5–10 segundos.
- P6, **antes do grafo de pedestres**, com busca ampliada: benchmark BH (UFMG → Centro, 18/11/2026): `departAt/fastest` 23,53 segundos e `arriveBy/leastTransfers` 15,55 segundos, seis itinerários, sem limites explícitos alcançados. Desempenho ainda não adequado para uma experiência móvel instantânea.
- Com o grafo OSM, exige-se novo benchmark e inspeção da cobertura de acessos. **Não** prometer benefício até os testes reais confirmarem.

## Limitações remanescentes

**Nenhum motor pode garantir um itinerário perfeito sem cobertura da rede e dados operacionais verificáveis.** A P6 ainda apresenta:

- **Ônibus:** grade GTFS oficial programada; GPS e atrasos não estão associados com segurança ao `trip_id`. Cancelamentos e obras podem mudar partidas reais.
- **Metrô:** catálogo de linhas/estações e links oficiais de previsão, mas sem grade ferroviária GTFS / API validada que permita integrar esperas e transferências em uma única busca com ônibus.
- **Caminhadas:** a rede OSM pode estar incompleta; a localização da entrada real, passarela, calçada, travessia, túnel e acessibilidade exige validação local. O nó OSM mais próximo pode estar fora do ponto de acesso correto.
- **Heurísticas de busca:** máximo 3 embarques, limites de rótulos e ordem por preferência; `ok` significa que nenhum limite explícito foi atingido, não prova de ótimo global em todas as dimensões.
- **Atualização:** grafo OSM estático precisa ser reconstruído periodicamente sob supervisão de integridade. O GTFS do ônibus pode mudar independentemente de dados em tempo real.
- **Infraestrutura:** backend Python local; Firebase Hosting Spark apenas fornece arquivos estáticos. Publicar exige decisão de hospedagem, segurança, cache e consumo.
- **Licenças:** atribuir © OpenStreetMap contributors e cumprir ODbL para bases derivadas e distribuição. Dados e condições GTFS das fontes públicas também devem ser respeitados.

## Arquivos

- `transit/planner.py`: busca temporal com índice invertido, restrições e A* pedestre opcional
- `transit/walking.py`: grafo A* offline e busca por caminhos conectados
- `scripts/build_routing.py`: GTFS schema 2
- `scripts/build_walking.py`: gerador OSM
- `.github/workflows/build-routing.yml`: índices de ônibus atualizados só na P6
- `.github/workflows/build-walking.yml`: recorte OSM e geração do grafo pedestre só na P6
- `.github/workflows/test-routing-real.yml`: testes com índice GTFS verdadeiro
- `tests/test_gtfs_precision.py`, `tests/test_walking.py`: regras e barreiras

## Aceite para produção

Sem liberação automática. A aceitação depende de: cobertura OSM real de bairros e da UFMG, verificação de trajetos de caminhada em campo e pela rede, 30+ pares origem/destino diversos, tolerância de tempo/erro frente a horários oficiais, retorno em tempo adequado no Android de entrada, UI mobile homologada e fonte autorizada e estável para GPS/metro. Dados insuficientes sempre devem resultar em aviso, nunca uma previsão fabricada.
