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