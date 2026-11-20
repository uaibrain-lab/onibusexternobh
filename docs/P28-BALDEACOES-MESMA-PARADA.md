# P28 — Auditoria gratuita de baldeações na mesma parada

**Repositório exclusivo:** uaibrain-lab/onibusexternobh
**Branch:** feat/gps-worker-free-homologacao-p15-20261117
**Status:** testes e código na branch; sem deploy. Não alterar Hub UFMG ou ru-hoje.

## Evidências que motivaram esta fase

O GTFS original do aplicativo mostrou que as linhas:
- 9106 + 5106 têm 22 stop_id comuns;
- 9209 + 67 têm 4 stop_id comuns;
- 9209 + 51 têm 0 stop_id comuns.

Isso não prova que os horários ou sentidos permitem baldeação.
O verificador OSM rejeitou sete candidatos 9106+5106 na busca de
referência, mas é necessário separar a restrição temporal da caminhada
e não inventar conexões sobre barreiras físicas.

## Implementado — somente leitura

- scripts/audit_same_stop_transfers.py pesquisa as linhas com data,
  hora, janela de até cinco horas, espera mínima e máxima.
- Lê APENAS os shards GTFS municipais usados pelo aplicativo, sem rede.
- Confere calendário, exceções, pickup_type, drop_off_type,
  embarque anterior, desembarque, embarque seguinte e dia de serviço.
- Compara horários programados em stop_id IDÊNTICO e trata corretamente
  horários GTFS 24h+ após meia-noite.
- Relata possibilidades programadas, até oito exemplos com stop_id
  público, sem expor trip_id, coordenadas ou tokens.
- tests/test_p28_same_stop_transfers.py cobre essa lógica com dados
  sintéticos, incluindo dia de serviço anterior e serviços cancelados.
- CI de integração executa automaticamente todos os test_*.py.
- Não altera o Connection Scan nem habilita ETA ao vivo.

## Comandos no Windows (sem deploy)

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
py -m unittest discover -s tests -p "test_p28_same_stop_transfers.py" -v

py scripts/audit_same_stop_transfers.py --first 9106 --second 5106 --date 2026-11-17 --time 22:00 --hours 3
py scripts/audit_same_stop_transfers.py --first 9209 --second 67 --date 2026-11-17 --time 22:00 --hours 3
py scripts/audit_same_stop_transfers.py --first 9209 --second 51 --date 2026-11-17 --time 22:00 --hours 3
~~~

Interpretar timedTransferPairs>0 APENAS como combinações GTFS
com margem no mesmo ponto. Isso NÃO demonstra itinerário
de origem a destino, caminhada, posição GPS, direção desejada,
embarque anterior ou ETA real. Valor zero não exclui troca entre
paradas próximas distintas.

## Próximas rodadas do agente recorrente

1. Ler o estado atual do GitHub Actions e corrigir falhas reais.
2. Rodar esse relatório com catálogo municipal e comparar os horários.
3. Para 9106+5106, localizar a diferença entre oportunidades temporais
   e as candidatas que o verificador OSM descarta. Usar o script
   diagnose_route.cjs com as mesmas coordenadas e data/hora da
   consulta Google/Moovit, sem publicar localização pessoal.
4. Concluir compatibilidade GTFS-RT por instância, stop_sequence
   preservado e fonte original versionada; não inventar frescor
   individual do feed com base apenas no FeedHeader.
5. Integrar horários metropolitanos DER/MG somente com paradas e
   cronologia verificáveis. Não inventar chegada a partir da saída
   do terminal.
6. Atualizar este roadmap com commits, testes, falhas e próximos
   passos a cada rodada. Não fazer merge na main nem deploy sem
   autorização. Evitar conflitos entre múltiplos agentes GitHub.

Restrições permanentes: sem Blaze, VPS, APIs comerciais, serviços pagos,
nem modificações no Hub UFMG, ru-hoje ou repositórios relacionados.

## P28M — Embarque/desembarque possível e auditoria temporal real (20/11/2026)

- **HEAD conferido antes do patch:** `5ab33a244a02d28362ce3f86cd1cd6ac08be3c7d`. Commit de código/testes/CI: **`b7b9e20ed49358c48ceb999ae37c76ec363f8017`**.
- `scripts/audit_same_stop_transfers.py`: não conta desembarque se não houver nenhum stop anterior com pickup permitido e partida cronologicamente anterior; não conta embarque se não houver stop posterior com dropoff permitido e chegada cronologicamente posterior. Cálculo em duas passagens lineares por viagem, sem coordenadas, serviços pagos ou estimativas GPS. Impede falso positivo de perna sem embarque/desembarque.
- `tests/test_p28_same_stop_transfers.py`: regressões sintéticas para origem proibida, destino proibido e inversões cronológicas; preserva cenários de 24h+ e serviços cancelados. Reprodução isolada local: 6 casos de conectividade da perna aprovados. **Suíte integrada remota aprovada**.
- `.github/workflows/integracao.yml`: passa a executar explicitamente a auditoria temporal com shards municipais reais, para referência de **17/11/2026 às 22h**, janela de 3h e espera de 2 a 30 min. Nenhuma coordenada pessoal foi fornecida ou armazenada.
- **Resultados reais** do mesmo catálogo municipal versionado (não representam itinerário ponta a ponta):
  - 9106 + 5106: 22 paradas de `stop_id` idêntico, **24 pares de horários programados** em 6 paradas, 303/411 instâncias ativas (primeira/segunda linha, contadas na janela estendida);
  - 9209 + 51: 0 paradas compartilhadas, **0 pares**; baldeação entre paradas distintas não foi avaliada nesta auditoria;
  - 9209 + 67: 4 paradas compartilhadas, **12 pares de horários** em 2 paradas.
- **CI confirmado no commit de código:**
  - Integração #44750411186: `completed/success`. **149 testes Python**, **159 testes Node/JavaScript**, preview com **9.828 pontos**, auditoria OSM e smoke HTTP aprovados. Link: https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44750411186
  - Testes P2 #44750423189: `completed/success` nas matrizes Python **3.11 e 3.13**. Uma tentativa anterior no mesmo SHA foi cancelada por concorrência; não era falha de testes. Link: https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44750423189
  - P9 Playwright #44750411046: `completed/success`, **21 testes passaram, 3 ignorados**, perfis desktop Chromium e Android emulado 360/390 px. Isso não substitui QA em dispositivo físico. Link: https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44750411046
- **Limitações que permanecem:** 24 combinações para 9106+5106 não validam a origem/destino desejados, nem sentidos, ruas OSM ou acesso a plataformas. 9209+51 necessita caminhar entre paradas diferentes. GTFS-RT ainda não está calibrado/homologado para ETA. DER/MG 411C/511C mantém apenas partidas informativas, sem horários por parada/geometria comprovados e com licença de redistribuição pendente.
- **Handoff:** conferir o HEAD da branch e o CI após este commit documental; obter coordenadas e horários de referência não pessoais, rodar `scripts/diagnose_route.cjs` com diagnóstico por estágio para 9106+5106 / 9209+51 / 9209+67. Depois focar uma correção de roteador fundamentada em GTFS+OSM, em vez de relaxar limites arbitrariamente. Validar instância, `stop_sequence`, calendário e frescor de TripUpdates. Evitar conflitos com outros agentes consultando SHA do arquivo; nunca fazer merge, deploy ou tocar Hub/ru-hoje.

## P28N — Evidência agregada por parada, sem identificadores de viagem (20/11/2026)

- HEAD inicial `1cf1f1444cf8919df0b4853e0820e54a8077a41f`, CI #44750866430 e #44750877190 aprovados. A auditoria temporal passou a incluir `stopEvidence` limitado a **20 paradas**, ordenado por número de pares de horários, com `stopId`, `scheduledTransferPairs`, `firstArrivalEvents` e `secondDepartureEvents`.
- Objetivo: localizar quais paradas concentram as oportunidades 9106+5106 e 9209+67 para depois investigar a integração no planejador e as travessias reais OSM. Sem `trip_id`, coordenadas de usuário, ETA ou acesso à rede; não implica viagem ponta a ponta.
- Regressão sintética adicionada para a estrutura agregada e saída vazia quando as linhas não compartilham parada. Os testes integrados do novo commit devem ser conferidos no GitHub Actions; se estiverem em execução, não declarar aprovação antecipada.
- Próxima ação: usar `stopEvidence` e o grafo OSM para selecionar os pontos públicos de referência, reproduzir a rota no `scripts/diagnose_route.cjs`, identificar rejeições por estágio, corrigir apenas com evidência e adicionar fixture E2E. Sem merge/deploy.

## P28O — Diagnóstico dos componentes OSM nas paradas oficiais (20/11/2026)

- Commit de código: `acc594ae641cce82ff75d4aa0651e3f2fed36ff1`, sobre `50ea3822576503b8839556cccf547c774ce5613c`. Arquivos: `scripts/audit_walk_graph.py`, `tests/test_p27_walk_graph_coverage.py`, `.github/workflows/integracao.yml`.
- A auditoria de cobertura OSM aceita agora `--focus-stops` com até 20 identificadores **públicos** de paradas GTFS e retorna `focusedStops`: status de snap, distância arredondada, grupo de componente conexa e quantidade de nós. Não expõe coordenadas nem cria ligações entre componentes. Uma parada sem snap ou ausente permanece explicitamente não verificada. Validação de IDs e conflitos de coordenadas duplicadas falha fechada.
- A integração CI executa o diagnóstico para as seis paradas com baldeação programada 9106+5106: `14786682,14789497,14785707,14786677,14787518,14789565`. São pontos públicos extraídos do relatório temporal; sua presença no mesmo componente **não prova** acesso seguro à plataforma, nem viabilidade de uma rota porta a porta.
- CI do commit de código: integração [#44768952714](https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44768952714) **success**; testes P2 [#44768968041](https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44768968041) **success**; P9 [#44768952805](https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44768952805) estava **in_progress** na última consulta. Nenhuma homologação física afirmada.
- **Próxima rodada:** extrair `focusedStops` do log integrado, verificar se as seis paradas têm snap e pertencem ao mesmo componente; confrontar com `scripts/diagnose_route.cjs` e rejeições por estágio, reproduzindo origem/destino de referência **públicos**, antes de modificar limites de busca. Para 9209+51, auditar as paradas distintas e ruas OSM, sem deduzir travessia por distância euclidiana.
- **Bloqueios remanescentes:** itinerários de referência completos e testes em aparelho real; matching/frescor/calibração GTFS-RT para qualquer ETA; licença e horários/geometria verificáveis para integração roteável DER/MG. Sem Blaze, serviços pagos, merge ou deploy. Antes de editar, reler HEAD, SHAs e CI para evitar conflito com agentes paralelos.

## P28P — Resultado efetivo do cruzamento OSM das seis paradas (20/11/2026)

- **Branch/HEAD antes deste registro:** `0f63c8eee6c681c61146317dfd9049fb71f91f7f`; commit do diagnóstico `acc594ae641cce82ff75d4aa0651e3f2fed36ff1`; documentação do outro agente `0f63c8eee6c681c61146317dfd9049fb71f91f7f`. A checagem do SHA do arquivo precedeu a edição.
- Evidência do **log real** da integração #44768952714: todas as seis paradas de maior interesse de 9106+5106 têm snap em até 70 m para o **mesmo componente principal** da malha pedonal OSM, com **390.433 nós**:
  - stop_id público `14786682`: 19 m; `14789497`: 19 m;
  - `14785707`: 11 m; `14786677`: 14 m;
  - `14787518`: 34 m; `14789565`: 22 m.
- **Conclusão limitada:** não são paradas isoladas em componentes separados do grafo. Isso não garante caminhada de origem/destino ou acesso seguro a plataformas, nem elimina rejeições por *street path distance budget*, ordem temporal, direção, geração/ranqueamento ou margens de embarque. Não relaxar limites OSM com base apenas nessa evidência.
- **Testes verificados do commit de código:** CI integração #44768952714 `completed/success`, **151 testes Python**, **159 testes Node**, preview estático com **9.828 paradas** e `HTTP_INTEGRADO_OK`. P2 #44768968041 `completed/success`; o commit de documentação intermediário `0f63c8e` também passou em integração #44769157003 e P2 #44769169192. Playwright P9 #44768952805 ainda constava `in_progress` na última consulta; conferir antes de afirmar homologação dos navegadores neste HEAD.
- **Handoff técnico:** próximo agente usar publicamente essas paradas para derivar **origem/destino/horários efetivos** de viagens programadas em ambos os lados da baldeação, sem coordenadas privadas. Rodar o mesmo motor com `scripts/diagnose_route.cjs` e `diagnostics:true` para comparar `generated`, `shortlisted`, `streetVerified`, `paretoRetained` e `stage_access/transfer/egress`. Investigar 9209+51 como paradas distintas por OSM real; não supor que os 47 pares dentro de 450 m sejam caminháveis. Continuam pendentes homologação GTFS-RT temporal/freshness, itinerários DER/MG, licença e QA físico. Nenhum merge/deploy ou serviço pago.

## P28Q — Diagnóstico de rota com stop_id público GTFS (20/11/2026)

- HEAD anterior `2f18c4735f68a6f5808e70b90e5c00cf4bd60d5b`, commit de código `1bc71b9a1e23b13b8bcb4c90652b817d64752f4a` na branch exclusiva. Arquivos: `scripts/diagnose_route.cjs` e `tests/test_p23_diagnostics.cjs`. SHAs verificados antes da edição; nenhuma modificação de runtime, main ou deploy.
- O diagnóstico CLI offline aceita agora `--fromstop=<stop_id>` e/ou `--tostop=<stop_id>` como alternativas aos parâmetros `--from=LAT,LNG` e `--to=LAT,LNG`. Lê somente `catalog/scan/stops.json.gz` local (limites de 25 MiB comprimido e descomprimido), valida até dois IDs públicos, existência, duplicatas conflitantes e bounding box BH; não chama serviços externos, não transmite posições privadas e não afirma ETA.
- Exemplo **a executar após checkout do catálogo**: `node scripts/diagnose_route.cjs --fromstop=14786682 --tostop=14789497 --at=2026-11-17T19:58:00-03:00 --focus=9106+5106 --depth=expanded`. Os IDs são públicos e presentes na auditoria OSM; **não há garantia de que essa combinação tenha itinerário válido nesse horário**.
- Regressões adicionadas: resolução de dois IDs de fixture gzip, ID ausente, ID inválido e duplicata com coordenadas conflitantes. **CI do commit de código**: integração #44779408742 iniciou `in_progress`; não declarar aprovação até o workflow concluir. A integração e P2 do HEAD anterior #44769424027 / #44769437757 terminaram `success`.
- Handoff: primeiro conferir conclusão e logs do CI, reproduzir uma consulta por paradas oficiais no motor com horário programado apropriado e examinar `result.diagnostics` para identificar a etapa de rejeição; não usar o exemplo como prova de rota. Investigar depois pares distintos 9209+51 com grafo OSM e calendários; homologar GTFS-RT por instância e frescor; DER/MG somente com geometria/horários oficiais e licença verificável. Sem Blaze, VPS, API paga, merge ou deploy.
