# P27 — Auditoria OSM por linha, compatibilidade GTFS exata e Mobile QA

**Estado:** desenvolvido na branch `feat/gps-worker-free-homologacao-p15-20261117` do repositório `uaibrain-lab/onibusexternobh`, sem merge/deploy. Não alterar Hub, ru-hoje ou Firebase.

## Objetivos e causas

Na P26, itinerários GTFS existentes como 9106+5106 eram eliminados na verificação de caminhada. A P26 ampliou as baldeações candidatas, mas não distinguia se o erro era falha de snap, componentes OSM desconectados ou orçamento de distância de percurso.

Além disso, o feed TripUpdates oficial SUMOB foi associado a 638/638 mensagens de viagem no ZIP GTFS baixado pelo usuário, mas o hash do ZIP não coincidia com o hash que originou o catálogo atual do app. **Hash divergente por si só não prova horários divergentes**, e correspondência de trip_id no ZIP novo não garante compatibilidade com a versão publicada do site.

A auditoria E2E P26 encontrou também sobreposição dos controles superiores em 360 px e um teste de GPS desatualizado.

## Implementação

1. **Analisar por que a rua falhou** em `static/walk-network.js`: `explainFailure(from,to,limitMeters)` identifica `fromUnsnapped`, `toUnsnapped`, `disconnectedPedestrianComponents`, `minimumWalkingDistanceOverBudget` ou `walkDetourExceedsBudgetOrSearchLimit`. Os componentes são calculados por visita à lista de adjacências somente na primeira chamada de diagnóstico. A rota OSM permanece exatamente como antes: **não ligar componentes, não inventar travessias, não mover pontos**. Retornar apenas categoria e métricas, sem coordenadas individuais no relatório.
2. **Integração diagnóstica em `static/route-worker.js`**: as mensagens `streetRejectionReasons` e `focus[].streetRejectionReasons` contam por combinação as classes detalhadas (`street_<categoria>`) quando `diagnostics:true`. O custo da decomposição não ocorre na busca normal.
3. **Medir cobertura real**: `scripts/audit_walk_graph.py`, sem rede, identifica conectividade do grafo OSM dos 9.925 pontos e, via `catalog/routing-stop-routes.json`, mostra a cobertura de linhas específicas. Não registra coordenadas dos passageiros.
4. **Comparar *diretamente* com o catálogo utilizado pelo cliente**: `scripts/audit_sumob_gtfs_match.py` ganhou `app_catalog_overlap()`, que lê `catalog/scan/trips.json.gz` e resume `appCatalogRTUpdateCount`, `appCatalogRTMissingCount`, `appCatalogRTPublicRouteCodeMatchCount`, versão `appCatalogGTFSVersion` e linhas sem correspondência. **Isso não valida calendário, instância ou propagação de delay e não habilita ETAs ao vivo.**
5. **Mobile QA**: `static/hub-parity.css` reserva áreas disjuntas para `#top .fab` e `.source-pill` entre 320–360 px; sem esconder rótulos acessíveis. `tests/browser-p9.spec.cjs` passa a validar resposta real com GPS opcional, sem exigir a mensagem antiga.
6. **Gates e versão PWA**: novos testes `tests/test_p27_walk_failure_explanations.cjs`, `tests/test_p27_app_catalog_overlap.py`, `tests/test_p27_walk_graph_coverage.py`, incluídos no build PowerShell, workflow Playwright e integração. `scripts/build_static_site.py` usa `p27-osm-audit-mobile-20261118` e shell v7. **Build novo obrigatório após alterações no Worker/CSS; nunca usar `-ReutilizarBuild` no build antigo.**

## Resultado real do GitHub Actions

Execução independente em 18/11/2026:
`https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44222091377`

- **115 testes Python aprovados**
- **127 testes Node/JavaScript aprovados**
- Smoke HTTP e pacote estático 141,39 MiB aprovados.
- Auditoria `P27_OSM_GRAPH_COVERAGE_OK` aprovada:

| Métrica | Resultado |
|---|---:|
| Nós OSM | 412.312 |
| Arestas OSM | 456.495 |
| Componentes OSM independentes | 772 |
| Nós no maior componente | 390.433 (94,69%) |
| Pontos GTFS analisados | 9.925 |
| Snap OSM em até 70 m | 9.783 (98,57%) |
| Pontos sem snap próximo | 142 |
| Pontos em componentes menores | 159 |
| Pontos no componente principal | 9.624 |
| Mediana da distância de snap | 21,5 m |

Por linha (dados da mesma execução, **paradas distintas**, não viagens):

| Linha | Pontos | Principal | Isolados | Sem snap |
|---|---:|---:|---:|---:|
| 9106 | 145 | 143 | 1 | 1 |
| 5106 | 158 | 150 | 3 | 5 |
| 9209 | 81 | 80 | 1 | 0 |
| 51 | 72 | 70 | 2 | 0 |
| 67 | 68 | 65 | 2 | 1 |
| 411C | 0 | 0 | 0 | 0 |
| 511C | 0 | 0 | 0 | 0 |

**Não concluir que o 9106+5106 falhou por aqueles 8 pontos do 5106** sem rodar a busca com origem, destino e horário idênticos aos do Google e observar `focus[].streetRejectionReasons`. Pontos adjacentes em componentes distintos podem se situar em vias separadas por barreiras reais; nunca conectá-los só para aumentar a cobertura.

## P27 Playwright e publicação

- Antes da P27, o Playwright da P26 falhava em Android 360px por sobreposição de controles e esperava a antiga mensagem `GPS em tempo real ainda não integrado`. Ambas as causas foram corrigidas no código.
- **A aprovação visual Playwright da P27 é uma etapa separada:** não confundir CI Node/Python bem-sucedido com verificação de 360/390/desktop. Registrar resultado do workflow `P9 - Navegadores mobile/desktop` ao finalizar.
- Não foi executado deploy de Cloudflare Pages/Workers nem integração com o Hub/Firebase.

## Próximas prioridades

1. Executar benchmark **com coordenadas reais** e tempo de 17/11/2026 para 9106+5106, 9209+51, 9209+67. Comparar horário, street rejection por categoria, margem da estação e detour OSM. Sem afirmar paridade com Google/Moovit prematuramente.
2. Executar P25C no mesmo horário com feed da SUMOB e ZIP GTFS oficial, agora incluindo `appCatalogRTUpdateCount`. Caso existam IDs ausentes, atualizar catálogo inteiro atomica e validamente, sem habilitar ETA antes de validar serviço e partida por `start_date/start_time`. A especificação GTFS-RT só permite propagar atraso nas condições corretas; `NO_DATA` interrompe propagação.
3. Dados metropolitanos DER/MG: a fonte pública `https://www.consultas.der.mg.gov.br/grgx/sgtm/acesso_informacao.xhtml` declara dois arquivos de texto de quadros de horários e itinerários (campos `COD_LINHA, HORA_PARTIDA, TIPO_DIA, DESC_PARADA`). **Horário de saída de terminal não é horário de passagem de cada ponto.** Usar dados somente após validar paradas e cronologia; 411C/511C não estão no GTFS municipal e não se devem inventar horários.
4. Revisar OSM de entrada em plataformas MOVE, `pathways.txt` e `transfers.txt` se existentes. A rede de ruas não prova conexão de entrada em estação.
5. Monitorar performance mobile: busca ampliada 90 candidatas, memória e uso CPU do Worker offline.

## Comandos de validação (Windows, sem deploy)

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
node --test tests/test_p27_walk_failure_explanations.cjs tests/test_p26_transfers_station_access.cjs
py -m unittest discover -s tests -p "test_p27_*.py" -v
py scripts/audit_walk_graph.py
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Publicar-GPS-Homologacao.ps1"
~~~

O segundo diagnóstico de SUMOB com app exato:
~~~powershell
# Reutilizar SUMOB_TRIP_UPDATES_URL apenas como variável local, sem registrá-la em Git
py scripts/audit_sumob_gtfs_match.py --gtfs ".\GTFSBHTRANS.zip"
~~~

Próxima IA: atualizar **este** documento com commits e CI/Playwright atuais; preservar fronteira do repositório e gratuidade, não afirmar deploy ou benchmark sem evidência.

## P27B - Conferência de sequência GTFS contra o catálogo EXATO (18/11)

Estado: somente branch, sem deploy em Pages, Worker, Firebase ou Hub.

Os relatórios de overlap anteriores comparam identificadores do scan, mas
não garantem calendário, hora inicial nem a sequência original de cada
parada. Novos recursos complementares:

- scripts/audit_sumob_catalog_match.py: lê UMA vez o feed oficial SUMOB
  e cruza com scan/index.json, scan/trips.json.gz, routing-index.json e
  shards locais por linha. Confere trip_id, route_id/código público,
  start_date e calendário com exceções, serviço ID idêntico entre scan
  e shard, start_time da primeira parada e stop_id. Só verifica a
  stop_sequence quando o shard realmente a conserva. Nunca registra
  coordenadas de usuários, cookies, tokens ou IDs individuais.
- tests/test_audit_sumob_catalog_match.py: testes para instâncias,
  horário, calendário, ids públicos, sequência não consecutiva,
  serviços de shard divergentes e privacidade.
- scripts/build_routing.py: futuras reconstruções completas adicionam
  o sexto campo stop_sequence aos registros de parada nos shards
  (índices 0 a 4 não são modificados), e marcam
  stopSequencePreserved=true. **Não migra automaticamente o catálogo
  publicado e não ativa previsões**.
- static/route-worker.js: no diagnóstico opt-in, falhas OSM são
  atribuídas a stage_access, stage_transfer, stage_egress ou
  stage_journey. tests/test_p27_walking_diagnostics.cjs confirma
  essas categorias e ausência de coleta em fluxo normal.
- Gate do PowerShell e watch P9 incorporam os testes novos. A suíte
  Python principal já faz descoberta automática de tests/test_*.py.

Comandos de homologação de leitura única (Windows):

1. Entrar em D:\Downloads\Externo-GPS-Teste e fazer git pull --ff-only
   da branch feat/gps-worker-free-homologacao-p15-20261117.
2. Executar: py -m unittest discover -s tests -p "test_audit_sumob_catalog_match.py" -v
3. Executar: node --test tests/test_p27_walking_diagnostics.cjs
4. Reutilizar somente LOCALMENTE a variável SUMOB_TRIP_UPDATES_URL do
   diagnóstico anterior e executar: py scripts/audit_sumob_catalog_match.py
5. Remover a variável de ambiente depois. Não enviar URL inteira ao GitHub.

Interpretação:
- tripIdFoundInApp é compatibilidade com a versão do site, não
  apenas com o ZIP oficial baixado novamente.
- activeServiceMatches e startTimeMatchesAppSchedule distinguem
  calendário e instância; routingShardServiceMismatch impede misturar
  scans de versões diferentes.
- stopIdPresentInTrip sozinho NÃO é prova de stop_sequence;
  stopSequenceNotPreserved alto é esperado antes do rebuild.
- stopIdAndSequenceVerified será zero no catálogo sem sexto campo.
- readyForLiveETA continua SEMPRE false; timestamps individuais de
  atraso não foram observados e propagação ainda não foi homologada.

Próximos bloqueios: benchmark 9106+5106 com os mesmos locais/hora;
reconstrução íntegra de scan + shards a partir de um ZIP validado;
regras de atrasos e serviço; QA Android/Playwright; e DER/MG para
411C e 511C. Não alegar paridade com Moovit/Google.


## P27C - GTFS original e rotas compartilhadas (18/11)

O arquivo do usuário BH-Transporte.zip contém, como arquivo interno,
GTFSBHTRANS.zip. Seu SHA-256 completo é:

ef448448ac0aa89877e33a34645acaac34a5bb45d9a849e2c5b92cdc238366b1

Igual ao catalog/source-gtfs.sha256 da branch. Assim, a versão
estática ORIGINAL do app pode ser examinada e regenerada de forma
reprodutível sem depender de um novo ZIP oficial. Não substituímos o
catálogo publicado nem subimos o ZIP ao GitHub.

Auditoria offline dessa fonte GTFS, usando routes, trips, stop_times e
stops:

| Linha | Paradas GTFS distintas |
|---|---:|
| 9106 | 145 |
| 5106 | 158 |
| 9209 | 81 |
| 51 | 72 |
| 67 | 68 |

A interseção é importante:
- 9106+5106: 22 stop_id IDÊNTICOS compartilhados;
  há 458 pares dentro de 450m (contagem de pares, não conexões válidas).
- 9209+51: 0 stop_id idênticos, 47 pares de pontos dentro de 450m.
- 9209+67: 4 stop_id idênticos, 56 pares dentro de 450m.

São pares espaciais, SEM análise de sincronização horária, direção
do ônibus, tempo de espera ou travessia real OSM. Não há garantia de
baldeação viável: 9106+5106 pode usar parada comum, mas a consulta
exata descartou sete candidatos no verificador viário.

A ausência de 411C/511C nesse ZIP confirma que a cobertura
metropolitana não vem da SUMOB municipal. Identificada uma fonte
OFICIAL pública de quadros de horários e itinerários DER/MG em texto:
https://www.consultas.der.mg.gov.br/grgx/sgtm/acesso_informacao.xhtml
Ela documenta campos COD_LINHA, TIPO_DIA, HORA_PARTIDA,
NUM_LINHA, DESC_PARADA e nomes de quadros/itinerários.
Neste ambiente não foi possível baixar o texto (acesso HTTP 403).
Sem a versão íntegra e dados geográficos por parada, NÃO fabricar
GTFS sintético com horas de chegada presumidas para 411C/511C.

## Gate CI após correção de compatibilidade do sexto campo

O build_routing.py passou a adicionar stop_sequence no campo 6.
Uma versão inicial quebrou os consumidores antigos Python, e a
regressão foi detectada pelo GitHub Actions (7 testes afetados).
Corrigido transit/planner.py para ler row[:5], preservando
compatibilidade com os shards de cinco E seis colunas.
tests/test_planner.py agora exige o novo stop_sequence no fixture.
Novo auditor de catálogo compara serviço entre scan e routing
e resolve o dia da semana de forma independente do idioma Windows.

O workflow da integração para a revisão ec93a649 passou:
https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44223309587
- Python: 123 testes aprovados.
- Node: 130 testes aprovados.
- Build estático, auditoria OSM, orçamento e HTTP smoke aprovados.
- Playwright P9 e a matriz P2 são verificações separadas;
  verificar seus resultados antes do deploy.

**Sem deploy nesta rodada.** O Worker GPS não recebeu ETA e o
site não foi atualizado. Não usar -ReutilizarBuild na P27.

## P27 — Fast path mobile sem candidatos OSM (22/11/2026)

- HEAD inicial `45087804f54c0beeee74df9f80375a71c33ca24e`; integração #45020205933 e P2 #45020211293 aprovados nesse HEAD anterior. PR principal #19; nenhuma edição em arquivos de importadores/datasets do agente auxiliar.
- Código `dc3b9cf87312387b9485c61d63ed52b0950d93a7` (`static/walk-network.js`): `distancesToStops` retorna mapa vazio quando nenhum destino tem snap válido. Antes, executava Dijkstra sem nenhum alvo, podendo expandir até 30.000 nós OSM em dispositivos móveis. Não altera rotas existentes, conectividade, GPS ou ETA.
- Regressão `28482ceb2ee9954f2525b5775df6d50bfdade884` (`tests/test_walk_network.cjs`): alvos vazios/sem snap não percorrem adjacências; destino válido mantém distância real.
- Verificações isoladas executadas no runtime JS com grafo sintético: 3/3 aprovadas (alvos vazios, alvos sem snap, destino válido). **Suíte Node completa e CI dos commits novos ainda não confirmados**; verificar Actions no novo HEAD antes de homologar. Sem benchmark real quantificado nem jornada E2E comprovada nesta rodada.
- Próximo gate: confirmar integração e P2 no novo HEAD, executar `node --test tests/test_walk_network.cjs` no checkout completo e diagnóstico `scripts/diagnose_route.cjs` com coordenadas/data/hora de referência verificadas. Investigar 9106+5106 e 9209+51/67 por calendário, direção, acesso e rede OSM, sem fabricar conexões. Sem merge/deploy.

## P27 — Acesso pedestre acima do orçamento (22/11/2026)

- HEAD de partida `8712ec01d678833d576eaeb316a46e63ca0f3d5c`, integração #45030302159 e P2 #45030305798 aprovados; PR principal #19. Sem alteração de datasets/importadores do agente auxiliar.
- Código `e5b7a3d6c8a3bd18ffa166d6e43eded68d875798`: `distancesToStops` elimina candidatos quando somente a soma das duas distâncias de snap já excede o orçamento pedestre. Isso evita Dijkstra inútil e não descarta qualquer rota que pudesse caber no limite.
- Teste `1196aa14cdea8fe979edfce1ed00892e30b62940`: grafo sintético com dois acessos de aproximadamente 40 m e orçamento de 70 m; adjacência instrumentada para detectar travessia desnecessária.
- Validação pré-commit: três checagens isoladas de limite aritmético em Node; **não equivalem à execução do arquivo completo de testes**. Conferir integração/P2 no novo HEAD e executar `node --test tests/test_walk_network.cjs` antes de homologar.
- Handoff: preservar OSM real e dados GTFS oficiais; medir impacto mobile e testar jornadas reais 9106→5106/9209→51 ou 67 com calendário, sentidos e paradas alternativas. Não assumir que 58 baldeações temporais são jornadas completas. Sem merge/deploy.

## P27 — Evitar A* com acesso OSM inviável (22/11/2026)

- Base `d29954fba4f5545243af3dbaca9a08feea675291`; PR #19. CI anterior aprovado: integração #45030819368 e P2 #45030823143.
- Código `52caa193336ac135127a003271c52bbaebd3bf60` (`static/walk-network.js`): `route` retorna `null` antes do A* se as duas distâncias de snap já ultrapassam o limite de caminhada; mantém fail-closed, sem atalhos fictícios ou mudança de ETA.
- Teste `a661b93a7ce81ea0f7e8373c15aef4de38c2df88` (`tests/test_walk_network.cjs`): dois endpoints com snap em nós diferentes, custo de acesso superior ao orçamento, instrumentação para impedir expansão de adjacências.
- Validação local isolada: três asserções Node sobre a condição de limite passaram; **não foi executado o arquivo completo de testes em checkout local** (DNS do git indisponível). Conferir CI no HEAD final, rodar `node --test tests/test_walk_network.cjs` quando disponível.
- Próximo gate: jornadas reais GTFS + caminhada OSM para 9106→5106 e 9209→51/67; medir latência em Android e verificar horários/serviço e conectividade. Sem alterações nos datasets do auxiliar, merge ou deploy.

## Escopo V1 municipal aprovado em 22/11/2026

- Decisão de produto: adiar planejador, baldeações/caminhadas OSM e RMBH até nova autorização; priorizar pontos, linhas/sentidos, horários GTFS municipais programados por calendário, metrô informativo, favoritos, PWA e localização opcional. GPS ao vivo não é requisito de lançamento.
- Base inicial `03f1df16b149c1e35a6f163d5891dbcdc104be6a`: integração #45035901115 e P2 #45035908369 aprovados. PR principal #19.
- UI `e683bc7210609dd1ef4adfe5c319107cb6b6fdba`: aba Rotas oculta/desabilitada, painel `inert`, link metropolitano retirado do fluxo municipal; código e arquivos futuros preservados.
- Guarda `947b8def04fa0ea2548ebfbe2e32ac5082ef5542`: chamadas internas de `switchTab('rotas')` voltam a Pontos. Teste `9ce1a6ae0bc1f013cd5532350736d661ca32f955` protege o contrato V1.
- Validação: CI novo pendente de confirmação; executar `node --test tests/test_unified_ui.cjs`, regressões de mapa/horários/metro/favoritos, build estático, HTTP e Playwright mobile. Não declarar V1 homologada antes desses gates; Android real ainda não verificado.
- Próxima rodada: confirmar CI, verificar se há outras entradas de planejador em UI/links, testar GTFS municipal e cache offline, preparar preview gratuito sem deploy. Sem editar datasets/importadores do agente auxiliar, sem merge/deploy.

## V1 municipal — Playwright touch targets, 22/11/2026

- HEAD inicial `1e11ab3f40e84a22bbc0a4befd171c4c3b89c77e`; integração #45052175047 e P2 #45052177409 aprovados, Playwright #45052175164 falhou em 6 casos (desktop/Android 390/360) por incluir aba Rotas oculta nas métricas: altura zero era comparada ao mínimo de 44 px. Outros 9 passaram e 9 foram ignorados.
- `009188e161df89d004fdc2823b4aa211640ecc8d`: `tests/browser-p15.spec.cjs` mede altura só de Pontos, Linhas e Metrô, mas continua exigindo Rotas oculta.
- `ae1338445ce2b6e953afa1f9c94514a3dc853edd`: `tests/browser-p20-map-ui.spec.cjs` restringe cálculo de altura, sobreposição e largura às três abas visíveis, preservando checagem explícita da aba adiada.
- Verificação isolada local Node: 3 asserções passaram sobre seleção de abas visíveis e altura mínima; não é execução Playwright. Gate obrigatório: conferir novo workflow P9 em desktop e Android emulados, integração/P2, depois Android físico e build/HTTP/GTFS municipal. Sem merge/deploy nem alteração de importadores/dados do agente auxiliar.
