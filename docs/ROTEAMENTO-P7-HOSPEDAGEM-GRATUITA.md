# P7 — Planejador de rotas com hospedagem exclusivamente gratuita

**Situação:** implementação concluída na branch `feat/externo-p7-rotas-estaticas-gratuitas-20261117`, sem alterar `main`, o Hub UFMG ou a produção. A versão estática é um preview de homologação e **não** equivale ao site completo publicado.

## Arquitetura sem cobrança por consulta

- **Cálculo**: `static/route-worker.js` (JavaScript puro no Web Worker do navegador). A origem, o destino e o horário não são enviados a servidor de roteamento ou API comercial.
- **Dados**: GTFS convencional PBH/SUMOB, processado em `scripts/build_routing.py` e `scripts/build_static_scan.py` por GitHub Actions, somente recursos padrão de Python.
- **Formato**: 5 inteiros de 32 bits (little-endian, 20 bytes por conexão): ponto origem, ponto destino, horário de partida, horário de chegada e ID de viagem com bits de embarque/desembarque. Arquivos `.bin.gz` por hora, para as direções de partida e chegada.
- **Hospedagem estática**: arquivos `HTML`, `CSS`, `JS`, catálogos GTFS e catálogo de metrô, compatíveis com Firebase Hosting **Spark**, sem Cloud Functions, instância, banco pago, Motor MOTIS hospedado ou pagamento por rota.
- **Endereços**: busca local por nomes de pontos e estações, coordenadas ou seleção direta no mapa. O Nominatim público foi **retirado do planejador estático**; não existe geocodificador comercial.
- **Metrô**: linhas/estações/horários habituais cadastrados, sugestões informativas entre estações. Sem previsão individual de trens ou promessas de conexão cronológica com ônibus.
- **Mapa base**: tiles OSM públicos conforme disponibilidade e política do provedor, com atribuição. Não oferece SLA; o mapa ainda não é hospedado integralmente pelo projeto.

## Custos, limites e cotas

Firebase Hosting Spark oferece atualmente até **10 GiB de arquivos hospedados** e **10 GB de transferência por mês**, em franquia compartilhada pelo projeto. Se ultrapassar a transferência mensal, o Firebase pode suspender o site no Spark até o mês seguinte. **Não fazer upgrade para Blaze por conta do projeto.**

Fonte: https://firebase.google.com/docs/hosting/usage-quotas-pricing

O índice da P7 tem **6.577.312 conexões**, **113.692 viagens** e **9.925 paradas** da versão GTFS de 17/11/2026. Os blocos bidirecionais comprimidos somam aproximadamente **110 MiB** em armazenamento, mas **não são baixados integralmente pelo navegador**. No teste real no GitHub Actions (simulação de leitura local sem latência de internet):

- `departAt` às 08:00, UFMG para Centro: 6 itinerários em 5,43 segundos, 18,35 MB de arquivos lidos.
- `arriveBy` às 08:00: 6 itinerários em 3,05 segundos, 13,69 MB adicionais; caches ajudam nas consultas seguintes.
- Ambos retornaram `partial`, pois a redução de rótulos limita a garantia de melhor alternativa global.

**Não** inferir que esses tempos serão iguais no Android ou nas redes móveis. A franquia de transferência de 10 GB/mês é especialmente relevante se muitas pessoas pesquisarem itinerários inéditos.

## Como gerar e testar

Com Python 3.11+ e o índice P6 v3 já disponível:

    py -3 scripts\build_static_scan.py catalog
    py -3 scripts\build_static_site.py
    node --test tests/test_static_worker.cjs
    node tests/benchmark_static_worker.cjs

Os arquivos prontos para um hosting estático ficam em `dist/externo/`. A configuração de Hosting fica em `dist/firebase.json`, com `public: "."`, para ser usada a partir da pasta `dist`.

Para inspecionar sem custo, rode um servidor HTTP estático local, nunca `file://`:

    py -3 -m http.server 8765 --directory dist

Acesse `http://127.0.0.1:8765/externo/`.

O workflow `.github/workflows/free-preview.yml` gera um **artefato de homologação**, executa teste HTTP e o anexa ao GitHub Actions, **sem fazer deploy**.

Não modifique nem publique arquivos do Hub UFMG sem homologação e autorização de integração.

## Escopo exato do preview estático

**Disponíveis:** página de **Rotas**, métricas do cálculo, busca local por pontos/estações, data de partida ou chegada, opções mais rápida/menos caminhada/menos baldeações, horários GTFS de ônibus, representações esquemáticas no mapa e catálogo de metrô. O site usa a mesma base geográfica de Belo Horizonte.

**Temporariamente ocultas no preview:** as abas P2/P3 de pontos/linhas de ônibus com consultas GPS, porque a implementação original ainda exige endpoints Python. Elas permanecem no código e no preview Python local. A migração destas consultas para os recursos gratuitos do Hub é tarefa posterior. Não anunciar P7 como migração completa do site.

**Ainda não disponíveis com precisão verificada:** caminhada real por vias OSM, previsões GPS por `trip_id`, bilhetagem/tarifas de integração, perfis de acessibilidade e horários metroviários de cada estação. As rotas não asseguram chegada pontual e não possuem prova de equivalência ao Google Maps/Moovit.

## Atualizações automáticas: risco de validade

O conteúdo do P7 foi produzido de uma versão oficial com validade máxima declarada até **31/12/2026**. O Worker rejeita datas após a validade; ele não extrapola linhas ou horários.

A P7 já tem o gerador livre e reproduzível, mas **não há atualização automática de produção** enquanto o preview não for homologado, consolidado na branch final e conectado ao deploy estático. Futuramente, é necessário configurar uma rotina gratuita que rebaixe o GTFS, revalide, regenere o índice e publique o Hosting, sob as cotas de GitHub Actions e Firebase Hosting. Não garantir funcionamento eterno ou gratuidade ilimitada de serviços terceiros.

### Arquivos relevantes

- `scripts/build_static_scan.py`: converte GTFS P6 em blocos horários para o navegador
- `static/route-worker.js`: motor GTFS bidirecional isolado da UI
- `static/app.js`: ligação da UI com Worker em vez de API Python
- `scripts/build_static_site.py`: pacote estático com flags para exibir só recursos disponíveis
- `tests/test_static_worker.cjs`: cenários sintéticos com restrições de embarque, tempo e calendário
- `tests/benchmark_static_worker.cjs`: benchmark com dados reais em memória local, sem rede
- `.github/workflows/static-routes.yml`: gera índices do GitHub sem deploy
- `.github/workflows/free-preview.yml`: valida e entrega pacote de homologação (sem deploy)
