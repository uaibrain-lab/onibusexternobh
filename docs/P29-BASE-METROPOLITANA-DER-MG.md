# P29 — Fontes oficiais DER/MG e gate de cobertura metropolitana (19/11/2026)

## Resultado da pesquisa independente

Fonte primária oficial: https://www.consultas.der.mg.gov.br/grgx/sgtm/acesso_informacao.xhtml
O DER/MG publica **Quadro de Horários RMBH** e **Itinerários RMBH** em texto (resposta pública via Lei de Acesso à Informação confirmada em https://www.der.mg.gov.br/1323-transparencia/respostas-portal-da-transparencia, protocolo 02301000020202073).

Dicionário publicado pelo DER/MG:
- `quadro_horario_rmbh.txt`: COD_LINHA, TIPO_DIA, NOME_QUADRO, HORA_PARTIDA, NUM_LINHA, NOME_LINHA.
- `itinerario_rmbh.txt`: COD_LINHA, NUM_LINHA, NOME_LINHA, TIPO_ITI, NOME_ITI, DESC_ITI, DESC_PARADA.

Consulta individual oficial: https://www.consultas.der.mg.gov.br/grgx/sgtm/consulta_linha.xhtml
Portal Minas Gerais descreve consulta de linhas, horários, itinerários e pontos:
https://www.mg.gov.br/servico/obter-informacoes-sobre-o-transporte-coletivo-da-regiao-metropolitana-de-belo-horizonte

Fonte secundária de demanda (NÃO serve para rotas/horários):
https://dados.mg.gov.br/tl/dataset/seinfra_demanda-onibus-metropolitano

## Limites e bloqueios reais

- Página primária indexada e dicionário verificado por busca, mas acesso HTTP automatizado ao XHTML nesta execução retornou 403. **Nenhum snapshot bruto dos dois TXT foi obtido ou validado; não alegar cobertura DER implementada**.
- Dados de partida (`HORA_PARTIDA`) **não** contêm horários GTFS de chegada/passage por cada parada.
- `DESC_PARADA` não oferece por si só coordenadas, IDs GTFS ou geometria OSM de travessia. Não geocodificar descrições e fingir precisão.
- A licença de redistribuição dos arquivos brutos e o formato/delimitador/charset efetivos ainda precisam ser confirmados antes de publicar derivados.
- 411C/511C ausentes do catálogo GTFS municipal original (ver P27C). Não associar automaticamente dados metropolitanos aos IDs e calendários da SUMOB.

## Gate para uma integração offline-first e hospedagem gratuita

1. Obter manual ou automaticamente, por acesso permitido, os dois arquivos **do site oficial**, guardar origem, data da extração e SHA-256, tamanho e codificação em manifesto. Não inserir credenciais, cookies ou links de sessão no repositório.
2. Inspecionar amostra REAL antes de escolher delimitador, tipos de dia e codificação; testar parser com arquivo bruto e fixtures redigidos, preservar `COD_LINHA` e os nomes distintos de quadro/itinerário.
3. Converter somente **partidas comprovadas na origem**. Para cada itinerário, comparar `DESC_PARADA` com catálogo oficial georreferenciado e sequência direcional; sem confirmação, registrar cobertura como "horários/itinerários informativos", sem rotas ponto a ponto.
4. Validar pelo menos 411C e 511C contra consultas oficiais, em dia útil/sábado/domingo/feriado conforme documentação real do `TIPO_DIA`; não inventar calendários.
5. Só ligar ao planejador quando houver identificação de paradas e geometrias verificáveis, horários por parada comprovados, transferências OSM por vias caminháveis, testes integrados e licença de reutilização adequada.
6. Produzir shards estáticos sob demanda, com orçamento de tamanho e versionamento do catálogo; não introduzir Blaze, VPS, API paga ou coleta de GPS.

## Estado/handoff

- Branch exclusiva: `feat/gps-worker-free-homologacao-p15-20261117`; sem merge/deploy.
- Pesquisa concluída, **integração DER pendente de arquivos oficiais íntegros**. Próximo agente deve verificar primeiro HEAD, CI e SHA dos arquivos, buscar o download exato no DER e validar os campos/delimitadores originais antes de editar qualquer conversor.
- Paralelamente, P28L criou decodificação offline de TripUpdates e adapter estrito para instância/stop. Isso **não ativa ETA**, nem implica cobertura metropolitana.

## P29B — Arquivos DER/MG reais e consulta estática (19/11/2026)

### Fonte e integridade

O usuário forneceu os dois arquivos TXT originais. **Não** foram adicionados integralmente ao repositório; apenas um catálogo pequeno para duas linhas foi versionado.

| Fonte | Bytes | SHA-256 |
|---|---:|---|
| quadro_horario_rmbh.txt | 5.472.380 | b36f38c830c93db04d7c6c0fa6e6e9331b34553868407880a8fc2257199544b0 |
| itinerario_rmbh.txt | 865.826 | cf90c84e7093c5480d6118311d62bb37f8118028f2fc10346a90e0a4e6b70343 |

Arquivos UTF-8 com cabeçalho separado por TAB, registros por ponto e vírgula e algumas linhas físicas quebradas. HORA_PARTIDA contém HHMM e sufixos RI/PI que devem ser preservados, nunca interpretados sem documentação oficial.

- 411C: COD_LINHA 3757, Terminal São Benedito/BH via Antônio Carlos, 729 partidas, 9 quadros.
- 511C: COD_LINHA 3837, Terminal Vilarinho/BH paradora, 497 partidas, 9 quadros.
- **Nenhuma das duas linhas aparece no TXT de itinerários enviado** (0 registros de NUM_LINHA=411C/511C). Não confundir código interno COD_LINHA com o código público NUM_LINHA.
- Não há nos TXT datas de vigência comprovadas, tempos por parada, sequências de stop_id ou coordenadas. A interface exige seleção manual de tipo de dia/quadro; não assume automaticamente férias/feriados.
- Confirmar permissão de republicação específica antes de deploy público; página DER/MG oferece estes dados publicamente, mas a licença explícita dos TXT ainda não foi documentada.

### Commits e arquivos desta rodada

- e9c1cf8986a139b35299a8030ddc46d683a73f1c — scripts/build_der_metropolitan.py: importador fail-closed de horários brutos, com verificação de cabeçalho, formatos e identidade.
- edb8728e02232b52ec1fbbd39323919e89dc9129 — catalog/der-rmbh-411c-511c.json: 1.226 partidas autênticas preservando quadros e sufixos. Flags negativas para routePlanningEnabled, calendarVerified, georeferencedStops e perStopScheduleAvailable.
- ee777bde114afc1281f9dc82151c0798e8dfe04e — tests/test_build_der_metropolitan.py: regressões do parser e dados versionados.
- 86bb4fd133b20a8adc3b4d5f9739d05045f911f3 — static/metropolitan.html: consulta mobile de horários informativos, com avisos e atribuição.
- 688ffcc3eb8c01a20f2e5134e78993355758ce67 — static/metropolitan.js: exibe só o quadro explicitamente escolhido, sem ETA.
- 8da243336471a3fb7b6766ed373bbeaf54ae7fa3 — scripts/build_static_site.py: inclui arquivos DER apenas com schema e flags conservadoras.
- d98d585cc0a7374531175868b23292022d57ffe9 — static/index.html: acesso pela aba Linhas.
- 32f84ba18ecfdb2d9b7d9ae2e70b8ebaa3a8bb78 — static/service-worker.js: cache offline mínimo, sem novas dependências.
- 5b1c5ec533d065b1b6071834d63e78c23a06e34c — tests/test_der_metropolitan_page.cjs: seleção manual e rejeição de schema incompatível.

### Testes, limites e handoff

- Local Python 3.13: **8/8** testes do parser, incluindo uso real dos dois TXT e comparação de SHA-256; py_compile passou.
- Local Node.js 22.16: node --check metropolitan.js e **2/2** testes em ambiente JS simulado usando catálogo oficial local; HTML analisado sem erro. A suíte completa do checkout e QA Android não foram executadas localmente.
- HEAD anterior 79ae0b3ee7e2bfa6e67251bc135563c1e9ce1359: CI #44638620405 completed/success. O CI da nova entrega estava pendente ao revisar (run #44640781964); **verificar status do HEAD final**, corrigir falhas antes de merge/deploy.
- Só há consulta das **partidas do quadro DER/MG**. Ainda **não** existe roteiro metropolitano ponto a ponto, horário de passagem na parada ou ETA. Não inventar geometria.
- Próxima rodada: verificar CI, validar a página no build integrado e mobile. Buscar fontes oficiais de itinerários efetivos da 411C/511C e posições de paradas, licença de reuso, validade de quadros e semântica RI/PI. Integrar planejamento somente após identificação de sentidos, sequências, calendário, horários por parada e caminhos reais OSM.
- Nenhum deploy, merge, serviço pago, coleta de posição privada ou intervenção em outros repositórios.

## P29C — Falha fechada em relações GTFS-RT (20/11/2026)

- HEAD verificado antes da edição: `163d47835d29b3bf6de4c71114ba7f6b24bc9e9b`, árvore `e832af7bba73c84c73ec10cb96b2a2a04903b057`. Arquivos lidos pela API GitHub com SHA individual; somente esta branch é alvo.
- Mudança no adaptador de TripUpdates: o decodificador preserva o campo 4 de `TripDescriptor.schedule_relationship`; o seletor de instância descarta relações de viagem diferentes de `SCHEDULED(0)` e atualizações de parada com `schedule_relationship` diferente de `SCHEDULED(0)`, incluindo `SKIPPED` e `NO_DATA`. Campos ausentes seguem o padrão 0 definido pelo protobuf. Sem nova consulta de rede ou previsão GPS/ETA.
- Regressões protobuf cobrem códigos de relacionamento de viagem 0/1/2/3/5/6/7 e de parada 0/1/2/3, com verificação de que viagens programadas continuam aceitas.
- Validação local: Node.js 22.16.0, `node --check` do decodificador e `node --test tests/test_gtfs_rt_trip_updates.cjs` reproduzidos com o conteúdo exato dos arquivos e a alteração proposta: **8 testes aprovados / 0 falhas**. Não confundir com suíte completa, dados reais SUMOB ou homologação de ETA.
- CI remoto: consultar o workflow Testes P2 e integração do novo commit antes de homologar; no início desta rodada, o HEAD anterior tinha Testes P2 #44642508972 `completed/success`.
- Sem merge, deploy, Blaze, API paga, mudança no Hub/ru-hoje ou dados de localização privada. Próximos passos: verificar CI novo, testes Playwright/mobile, auditorias 9106+5106 e 9209+51 com horários/OSM reais, temporalidade do feed e licenciamento/itinerários DER/MG.
- Handoff: antes de novas edições, recuperar HEAD da branch e SHA dos arquivos. Manter este registro e o P27/P28 atualizados com resultados reais; o acesso GitHub autenticado contorna falha de DNS do git local.
