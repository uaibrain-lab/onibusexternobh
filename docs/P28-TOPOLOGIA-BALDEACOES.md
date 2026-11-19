# P28 — Auditoria gratuita de topologia das baldeações

**Data:** 18/11/2026. **Escopo:** somente repositório \`uaibrain-lab/onibusexternobh\`, branch \`feat/gps-worker-free-homologacao-p15-20261117\`. **Não houve deploy.**

## Contexto e descoberta

A comparação de roteiros com Google/Moovit não pode ser resolvida simplesmente aumentando raio e número de vizinhos. A combinação **9106 + 5106** pode usar paradas de MESMO \`stop_id\`, enquanto **9209 + 51** depende de conectores a pé entre pontos distintos. O Google Maps pode fornecer serviços metropolitanos ausentes no GTFS municipal. A P27 já classificou rejeições de caminhada com a rede OSM; a P28 agrega evidência de topologia do GTFS.

Auditoria independente no ZIP original do GTFS municipal do aplicativo (SHA-256 documentado em P27):
- \`9106 + 5106\`: 22 IDs de pontos compartilhados.
- \`9209 + 51\`: nenhum ID compartilhado.
- \`9209 + 67\`: 4 IDs compartilhados.

**Esses números não equivalem a conexões programadas viáveis.** Mesma parada não garante mesmo sentido, mesmo dia de serviço ou baldeação temporalmente possível. Paradas diferentes dentro de 450 m também não garantem rota pedestre pela rede OSM nem acesso a plataformas/estações.

## Implementado nesta rodada

- \`scripts/audit_transfer_topology.py\`: leitura local de \`catalog/scan/stops.json.gz\` e \`catalog/routing-stop-routes.json\`. Emite apenas contagens e distâncias agregadas. Usa grade espacial para evitar comparar todos os pontos, limita raio a 1–1000 m, no máximo 20 combinações, e opera sem rede, backend, API ou armazenamento.
- \`tests/test_audit_transfer_topology.py\`: testes para paradas compartilhadas, pares distintos, limites e códigos de linhas; validado sinteticamente no ambiente da IA.
- \`.github/workflows/integracao.yml\`: inclui auditoria no CI com os **dados reais presentes no repositório** e captura o resumo da topologia, sem baixar nova versão de GTFS. Não disponibiliza qualquer coordenada individual no relatório.

### Comando local

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
py -m unittest discover -s tests -p "test_audit_transfer_topology.py" -v
py scripts/audit_transfer_topology.py --pairs=9106+5106,9209+51,9209+67 --radius=450
~~~

Saída: \`sharedStopIds\` e \`distinctStopPairsWithinRadius\`, **não** ETA. Se os resultados de topologia diferirem do ZIP original, investigar versão/catálogo antes de concluir erro de roteamento. A auditoria **não verifica sentido nem horários** e não altera o motor em produção.

## Próximas ações prioritárias (não presumir concluídas)

1. Obter o diagnóstico real das linhas \`9106+5106\`, \`9209+51\` e \`9209+67\` no mesmo par exato de coordenadas/data/hora: separar \`streetDisconnected\`, margem e direção.
2. Melhorar o roteador de conexões apenas quando isso preservar **ruas reais, horários e folga de embarque**; jamais inventar travessias, movimento ou ETA. Para \`9106+5106\`, investigar por que conexões no mesmo ponto, se houver na data/horário, não sobrevivem ao scan/validação.
3. GTFS-Realtime SUMOB: validar serviço, trip_id, start_date/start_time, original stop_sequence e ausência de timestamp individual antes de qualquer estimativa visível.
4. Linhas 411C/511C: obter dados oficiais completos e georreferenciamento DER/MG; nunca inventar viagens/horários.
5. QA mobile (360px e 390px), CPU/memória e equivalência gratuita de hospedagem antes de deploy.

**Handoff obrigatório:** a próxima IA deve ler o estado de branch, commits mais recentes e workflows; anotar nesta seção os resultados reais da auditoria e do CI, atualizar pendências, e verificar arquivo SHA antes de qualquer edição. Não tocar em Hub/ru-hoje, não dar merge nem realizar deploy.


## Homologação confirmada — GitHub Actions

Commit de implementação e relatório: \`a4424f3885fd52de743f868db7acd61feaad3b7e\`.
Execução de integração: https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44225491488

Resultado observado diretamente nos logs, em 18/11/2026:
- **133 testes Python passaram** (unittest), incluindo a nova auditoria.
- **130 testes JavaScript passaram**, zero falhas.
- Build estático passou com 9.828 paradas.
- Auditoria real \`TRANSFER_TOPOLOGY_AUDIT_OK\` com:
  - 9106+5106: 22 \`sharedStopIds\`, 217 \`distinctStopPairsWithinRadius\`;
  - 9209+51: 0 compartilhadas, 47 pares distintos até 450 m;
  - 9209+67: 4 compartilhadas, 21 pares distintos até 450 m.
- \`P27_OSM_GRAPH_COVERAGE_OK\` e \`HTTP_INTEGRADO_OK\` aprovados.
- Os resultados acima coincidem com a análise independente da cópia
  original GTFS do usuário, sem consulta a APIs de terceiros.
- **Playwright/P9 é verificação separada; não presumir homologação da
  revisão sem conferir o workflow específico.**
- Não houve deploy em Pages/Firebase/Worker, nem integração ao Hub.

Próxima IA: atualizar este bloco com o SHA do próximo commit de código,
CI, Playwright e mudanças de dados quando existirem, sem apagar
pendências anteriores e sem duplicar a automação existente.

## P28D — Robustez da auditoria de coordenadas (18/11/2026)

- Branch de homologação, sem merge/deploy. Commits de código `7eb76d56c41525c6639476b222b6397583e4afa3` e teste `302e2f4db25fe1aaaefd232fb864093671ebbd6e`.
- `scripts/audit_transfer_topology.py` rejeita coordenadas `NaN`, infinitas, não numéricas ou ausentes com erro controlado. Isso evita contagens silenciosamente incorretas e exceções não previstas em relatórios topológicos; não altera o planejador, ruas OSM ou ETA.
- `tests/test_audit_transfer_topology.py` inclui regressões sintéticas para essas cinco classes.
- Acesso: Git local bloqueado por DNS, contornado com leitura/escrita autenticada do conector GitHub, verificando SHA de cada arquivo antes de alterar. Testes locais completos com catálogo real não executados nesta rodada; consultar CI do HEAD novo antes de considerar a mudança homologada.
- Próxima IA: conferir commits e CI da branch, executar `py -m unittest discover -s tests -p "test_audit_transfer_topology.py" -v`, auditoria real e Playwright. Investigar viabilidade temporal/OSM das combinações 9106+5106, 9209+51 e 9209+67, sem presumir resultado. Validar GTFS-RT por instância e DER/MG somente com fonte oficial. Preservar gratuidade e não fazer deploy/merge.

## P28E — Integridade das entradas do auditor (18/11/2026)

- Estado anterior confirmado: HEAD `c61b373976ac994183ac85d67f7d3cfe355426e3`, CI P2 #44324473903 `completed/success`, matrizes Python 3.11/3.13 aprovadas. Não houve deploy.
- Novos commits: `365cd19eb3f7a512e69a046bd731ba817127048e` (validar lista de linhas por parada e rejeitar stop_id duplicado com coordenadas divergentes) e `9d31573ee7874d41ba13dfad46b90204641993e0` (regressões para associação malformada, duplicata conflitante e duplicata idêntica).
- Motivação: dados inconsistentes poderiam produzir contagens topológicas enganadoras. A auditoria continua somente offline, sem ETA, caminhos artificiais ou mudança no planejador do usuário.
- Acesso Git local segue indisponível (`Could not resolve host: github.com`); conector GitHub autenticado permitiu leitura e escrita com verificação de SHA. **Os testes dos novos commits ainda precisam ser confirmados no CI do novo HEAD**; não confundir sucesso do commit anterior com aprovação desta revisão.
- Handoff: verificar CI de `9d31573` e do commit documental seguinte; executar auditoria real e Playwright no HEAD; investigar baldeações 9106+5106, 9209+51, 9209+67 com mesma data/hora e ruas OSM; conferir TripUpdates por instância exata, calendário, stop_sequence e freshness; não inferir horários DER/MG. Não fazer merge/deploy nem tocar outros repositórios.

## P28F — Validação estrutural de pares (18/11/2026)

- CI anterior: workflow P2 #44324759619 `completed/success` para `c69a916e55c4ae5dc06d4bb7c7b8f740dc321bf4`; nenhuma alteração concorrente detectada no início.
- Commits: `9f0999607db9eef506da64c3599325af7d41a0f2` (`scripts/audit_transfer_topology.py`) valida que pares são lista/tupla com 1–20 pares de exatamente dois códigos de linha textuais e seguros; `af452ae836568427b7b6dfb0ec6e4717efbbda6b` (`tests/test_audit_transfer_topology.py`) cobre entradas malformadas.
- Motivação: anteriormente entradas não textuais ou pares de comprimento incorreto podiam lançar TypeError/produzir desempacotamento inesperado em vez de falha controlada. A auditoria permanece offline, somente topológica, sem mudar o roteador ou prometer ETA.
- CI dos novos commits: consultar após o HEAD documental; não presumir sucesso do CI anterior. Testes locais de catálogo real/Playwright não executados nesta rodada, pois o checkout local permanece indisponível.
- Handoff: validar novo CI P2 e integração; executar diagnóstico de horários e caminhadas OSM para 9106+5106, 9209+51, 9209+67 com dados de referência. Verificar GTFS-RT por trip_id/route_id/data/start_time/stop_sequence/freshness. DER/MG só com fonte oficial íntegra; sem merge/deploy.

## P28G — Integridade global de stop_id (19/11/2026)

- HEAD inicial `a9d510b3863f5c445126890f5ee253ff462b5e6f` (sem concorrência); CI anterior #44407764800 `completed/cancelled`, não aprovado.
- Commits `48f4b5a517b4ebd973d9cb4a43395b04e63424a0` (auditor) e `ebea8963ccab19d95f2536022e5c595290450fa6` (regressões).
- O auditor agora verifica coordenadas conflitantes do mesmo `stop_id` globalmente, inclusive quando a parada não pertence às linhas pesquisadas ou está fora da região. Antes, a validação por linha-alvo não cobria essas duplicatas. Mantém contagens topológicas sem prometer rota/ETA.
- Reproduzido localmente com caso sintético mínimo (`REPRODUCED_AND_FIX_LOGIC_OK`); a suíte completa e os catálogos GTFS/OSM reais **não** foram executados localmente. GitHub autenticado permitiu edições com SHA verificado, contornando DNS do Git local. CI dos novos commits ainda não retornou workflow na consulta inicial; verificar antes de homologar.
- Handoff: verificar CI P2 e integração no HEAD final; executar unittest completo, build estático, auditorias reais e Playwright mobile. Diagnosticar 9106+5106, 9209+51 e 9209+67 temporalmente e sobre ruas OSM. Respeitar trip_id, route_id, data de serviço, start_time, stop_sequence e frescor no GTFS-RT; não inventar DER/MG nem ETA GPS. Não fazer merge/deploy.

## P28H — Metadados de instância GTFS-RT (19/11/2026)

- HEAD inicial `a5183efa758fab226189d504f3c052d8a913751b`, sem divergência na branch; workflow P2 #44574906480 `completed/success` para P28G.
- Commit `6101f0670b1cd03701002c9a190446ead54973cc`: `gps-worker/src/gtfs-rt.mjs` passa a preservar `TripDescriptor.start_date`, `start_time` e `VehiclePosition.current_stop_sequence` quando presentes e válidos, além de trip_id/route_id já existentes. Não estima ETA, não associa posição a horário previsto e não muda a fonte de dados.
- Commit `223a45dddac97813e63a4c47f9d1427221a08e5c`: `tests/test_gtfs_rt_trip_descriptor.cjs` adiciona casos sintéticos protobuf de viagem após meia-noite (25:15:00), sequência de parada, campos opcionais inválidos, filtro por linha e ausência de ETA. O CI de integração executa `node --test tests/test_*.cjs`.
- Validação isolada do parser executada com feed protobuf sintético em runtime JavaScript, confirmou um registro com startDate=20261119, startTime=25:15:00 e currentStopSequence=12. Os testes novos no GitHub Actions e a suíte integrada ainda **não foram confirmados** nesta revisão; aguardar resultado do HEAD antes de considerar homologado.
- Decisão: metadados de viagem são informativos e necessários para futura correspondência estrita com GTFS-RT TripUpdates; não representam correspondência confirmada, horários calculados ou previsão de chegada. A API continua sem ETA GPS.
- Handoff: conferir CI do HEAD, validar no catálogo real e Playwright mobile, diagnosticar 9106+5106/9209+51/9209+67 com calendário GTFS e ruas OSM. Implementar TripUpdates somente com verificação exata de trip_id/route_id/start_date/start_time/stop_sequence e frescor. Não inventar cobertura DER/MG nem realizar merge/deploy.
