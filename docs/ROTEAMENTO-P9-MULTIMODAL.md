# P9 — Caminhadas em vias OSM, metrô e abas gratuitas

**Branch de desenvolvimento:** `feat/externo-p9-multimodal-gratuito-20261117`. PR rascunho para P8. **Sem deploy e sem habilitação de serviços pagos.**

## 1. Abas Pontos e Linhas no Firebase Hosting Spark

`static/static-bus.js` usa catálogos locais públicos GTFS (`routes.json`, `stops.json`, `patterns.json`, `shapes.json`, `routing-stop-routes.json`) para substituir endpoints Python antigos relativos a:

- Listagem e busca de linhas municipais
- Listagem, localização e busca de paradas
- Variantes, pontos ao longo do percurso e geometria de referência
- Pontos próximos, favoritos, mapas de paradas e detalhes sem previsão inventada

`static/app.js` ativa as quatro abas no preview estático, preservando a arquitetura gratuita. **Ainda não há GPS ao vivo** nesse preview. Uma contagem desconhecida aparece como traço/indisponível, nunca como zero ônibus. Não confundir mapa de trajeto GTFS com localização real do veículo.

## 2. Caminhada sobre ruas de verdade, sem API paga

`scripts/build_walking_graph.py` processa extrato OSM aberto em PBF (pyosmium opcional gratuito) ou XML pequeno e gera `catalog/walk/graph.json.gz`. Respeita os tipos de vias indicados, bloqueia algumas restrições de acesso e barreiras mapeadas. `static/walk-network.js` aplica A* sobre as arestas reais, não conexões de linha reta; usa snapping limitado (70 metros) entre origem/parada e rede de vias. O snapping **não é uma garantia** de acesso real, calçada, passagem acessível ou entrada de estação.

`static/route-worker.js` carrega o grafo somente quando presente e verifica as etapas a pé de itinerários candidatos, descartando conexões sem caminho calculado ou cujo embarque já teria ocorrido. Sem grafo instalado, a caminhada continua em modo estimado **explicitamente identificado**. A rede de rua é opcional e não deve ser anunciada como pronta antes da geração e cobertura validada no GitHub Actions.

A rotina gratuita `.github/workflows/p9-walk-osm.yml` baixa extrato regional da Geofabrik, recorta BH e testa quantidade de nós/arestas e tamanho do catálogo antes de qualquer commit. **Nenhum deploy**. O download regional tem aproximadamente 800 MB e demanda tempo de runner gratuito; a rotina é pontual, não deve baixar o Sudeste diariamente.

Licença/atribuição: **© OpenStreetMap contributors, ODbL**, fonte Geofabrik, dados de vias sujeitos a erros e desatualização. Não há dados de elevadores, escadas, rampas, travessias controladas ou entradas das estações homologados em campo.

## 3. Estimativas temporais do metrô, sem horários inventados

`static/metro-timing.js` oferece apenas **janelas ilustrativas com incerteza**, usando referências históricas publicadas pela concessionária para Eldorado–Central (18m54s) e Vilarinho–Central (25m30s), frequências típicas e alertas excepcionais. Referência: https://www.metrobh.com.br/metro-bh-diminui-tempo-de-viagem/

O código não extrapola a Linha 2 nem o trecho novo Novo Eldorado sem benchmark validado. Para usuários com horário de chegada, mostra janela estimada, **não a saída real de um trem**. A integração ônibus+metrô ainda não é calculada como um itinerário único verificado porque faltam `trip_id`, quadros de partidas e trajetos de entrada validados. O metrô **não é classificado como opção exata** junto às linhas GTFS.

## 4. Menos descartes Pareto e critérios de qualidade

Ampliação conservadora de 8→12 rótulos por parada e 8→12 alternativas embarcadas, com limite de processamento explícito. `stats.partialReasons` separa:
- `labels`: frontes por parada tiveram poda
- `onboard`: candidatos de embarque descartados por cap
- `finals`: resultados finais excederam limite
- `scanLimit`: número máximo de conexões atingido

Se qualquer cap for atingido, a busca continua `status=partial`; **não afirmar melhor alternativa global**. Benchmark com GTFS completo do dia 18/11/2026: 6 itinerários, 4,80 s para saída (4,13 MB) e 2,09 s para chegada (3,48 MB); ambos parciais nesse runner específico.

## 5. Testes e homologação

- `python -m unittest discover -s tests -v`: 51 testes em CI, incluindo filtro OSM/barreiras.
- `node --test tests/test_static_worker.cjs tests/test_static_bus.cjs tests/test_walk_network.cjs tests/test_metro_timing.cjs`: 22 testes em CI, sem chamadas comerciais.
- `.github/workflows/p9-validation.yml`: benchmark GTFS e artefato estático, aprovação confirmada.
- `tests/browser-p9.spec.cjs` + `.github/workflows/p9-browser.yml`: **6 testes E2E Chromium aprovados**, em desktop 1366×768, Android emulado 390px e Android emulado 360px. Capturas de tela são anexadas ao Actions. Isso **não é teste em aparelho físico**.

### Validação física ainda necessária

Execute o build da P9 localmente ou um preview privado, sem alterar produção, e verifique em:
- Android modesto com Chrome, 360–390px: abrir todas as quatro abas, teclado e botões, busca de pontos e linhas, caixa de favoritos, seleção de origem/destino no mapa, voltar/avançar, rolagem.
- Android recente e PC: 4G lento, troca de app e retorno, modo noturno, acessibilidade de texto/contraste, orientação retrato/paisagem.
- Fluxo com GPS explicitamente permitido e recusado; **não compartilhar coordenadas com APIs de terceiros**.
- Comparação em campo de ao menos 20 viagens de BH (ônibus direto, transferência, ida/volta, fim de semana, noturno, acessos a metrô) contra placas e horários oficiais; registrar horário real de chegada/partida sem confundir com GTFS.
- Confirmar atravessamentos e entradas de estação, obstáculos, pontos deslocados, travessias, escadas e acessibilidade a pé.
- Medir descarga de arquivos, memória, CPU, latência e estresse de múltiplas pesquisas.
- Sem esses passos, **não declarar equivalência ao Moovit nem precisão operacional homologada**.

## Permanência gratuita e continuidade

Nenhuma Cloud Function, Blaze, instância paga, API de geocodificação comercial ou servidor de roteamento dedicado. Dados via arquivos estáticos, cálculo no navegador e geração por GitHub Actions, limitados às franquias gratuitas. O uso de tiles OSM públicos respeita regras do provedor e não possui garantia de disponibilidade ou gratuidade para volume ilimitado.

Os dados GTFS continuam sujeitos a validade; a P8 prepara rotina gratuita de renovação por checksum e calendário, mas a publicação de produção permanece manualmente bloqueada até autorização explícita.

**Estado P9:** arquitetura e implementações codificadas, regressões unitárias e E2E emulados aprovados. Grafo real e validação física dependem de confirmação própria, e a pesquisa permanece parcialmente ótima.


## Atualização de homologação — grafo OSM real

A geração regional da Geofabrik foi aprovada pelo job https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44103076737, usando o recorte real de BH com **412.312 nós e 456.495 ligações viárias**, comprimidos em **6.113.758 bytes**. O arquivo `catalog/walk/graph.json.gz` já foi instalado na branch P9, sem publicação em produção. O grafo foi testado pelo motor em pesquisa com o GTFS completo (não apenas fixtures). A geometria mapeada continua sujeita a eventuais falhas de OSM e de conexão entre endereço/ponto e rede de ruas.

**Benchmark completo com grafo OSM**: partida 7,92 s, com 15,79 MB de arquivos lidos no primeiro benchmark; chegada 4,02 s, com 3,48 MB adicionais. Ambos com 6 itinerários e `status=partial`. Este benchmark foi anterior à correção que removeu uma segunda requisição desnecessária do grafo; verificar o CI mais recente para os dados finais.

**Resultados parciais diagnosticados**: modo normal 12 rótulos por parada e 12 candidatos por veículo, com mais de 14 mil descartes de rótulos e algumas centenas de candidatos de embarque no cenário de referência. A P9 acrescentou `partialReasons` para diagnosticar o impacto e a opção **Busca ampliada** (`24×24` rótulos por parada e por veículo), que pode melhorar a cobertura, mas não garante solução global ótima, e consome mais CPU/RAM.

**Testes de navegador**: E2E Chromium com três perfis (PC e Android 390px/360px emulados) aprovados: 6 testes passaram em https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44103474173. A validação em dispositivos Android físicos permanece pendente.

## Fontes oficiais de metrô

A operadora confirma os benchmarks históricos de tempo entre Eldorado–Central (18m54s) e Vilarinho–Central (25m30s):
https://www.metrobh.com.br/metro-bh-diminui-tempo-de-viagem/

A rede P9 utiliza esses valores somente para estimativas de incerteza na Linha 1. Não há prova de partidas programadas exatas para todos os horários ou estações, portanto a integração cronológica completa e verificável **continua pendente**. Não usar as janelas históricas para garantir transferências entre ônibus e metrô.
