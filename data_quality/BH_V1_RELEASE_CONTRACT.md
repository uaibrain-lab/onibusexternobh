# Contrato de qualidade — Externo BH V1 municipal (22/11/2026)

**Decisão de produto:** a V1 consulta **somente ônibus municipais de Belo Horizonte e metrô**, com pontos, linhas, sentidos/variantes e horários **programados**, além de favoritos e PWA. **Não incluir RMBH/DER, cálculo de rotas, transferências, caminhada OSM ou ETA GPS não homologado.** O agente principal cuida da UI, build, integração e deploy; este PR altera exclusivamente `data_quality/`.

## Gate de lançamento somente leitura

```bash
python -m data_quality.bh_v1_release_gate catalog --date 20261122
python -m data_quality.bh_v1_release_gate catalog --date 20261122 --arrivals-index dist/externo/catalog/arrivals/index.json --require-arrivals
python -m unittest discover -s data_quality -p 'test_*.py' -v
```

- A primeira execução valida referências/cobertura do catálogo municipal, condições de serviço e metadados do metrô, sem construir nada. A segunda é o **gate obrigatório do pacote estático**, após build, e compara o índice dos 256 buckets de chegadas ao mesmo GTFS e ao número de pontos com horário.
- Saída JSON com `status=pass|blocked`, `errors`, `warnings`, data consultada, versão, validade, contagens e SHA-256 da **origem ZIP**. O processo retorna exit code `2` quando o gate é bloqueado. Não altera arquivos nem rede.
- `stops_without_scheduled_arrivals` é diagnóstico, **não autorização para inventar previsão**. Valida-se a existência do hash da origem, mas ele sozinho **não prova** que cada artefato foi derivado desse mesmo ZIP. A homologação completa exige build atômico e testes do agente principal.
- A data de serviço precisa estar dentro de `feedStartDate`/`feedEndDate`, com ao menos um serviço ativo segundo `timetable-calendar.json`. Exceções são aplicadas apenas quando os IDs correspondem a serviços do catálogo. Dados vencidos ou incompatíveis bloqueiam a publicação.

## Evidência do catálogo existente, inspecionado via GitHub

Na branch-base de integração, versão `202611161919`, validade publicada `20261231`: **326 linhas**, **9.925 paradas** (nenhuma coordenada fora dos limites numéricos), **9.828 paradas com horários**, **6.691.004 registros de passagens**. Em **22/11/2026 (domingo)**: serviços municipais `307680` e `307683` ativos segundo o calendário persistido. Metrô cadastrado com **22 estações**, **2 linhas**, e sem referências de estações inexistentes. O total do catálogo e o calendário conferem. Isso **não equivale a teste HTTP do site, prova da origem do GTFS, garantia de operação em campo ou validação de tempos reais**.

Um detalhe a corrigir com o agente principal na etapa de empacotamento: o `manifest.json` lista `coverage-diagnostic.json`, mas esse arquivo não está presente na raiz do catálogo da branch-base consultada. Verificar se deve ser removido do manifesto ou produzido pelo build, sem misturar dados de fontes.

## Handoff para o agente principal

1. Ocultar a aba **Rotas** na V1 sem apagar o código e não exibir RMBH. `data_quality` não altera UI.
2. Incluir o gate de **pacote estático** em CI e no procedimento de homologação/preview (o agente principal é dono de CI/build).
3. Confirmar a renovação atômica de GTFS/chegadas/manifesto, conforme políticas de validade; não publicar a V1 com índice ausente/divergente.
4. Executar testes Python, JS, HTTP e Android real; medir custo de banda; manter GPS gratuito como opcional **desabilitado** até homologação da fonte/Worker.
5. Somente após homologação, pedir autorização separada para merge/deploy no Hub UFMG; sem qualquer modificação de `main` nesta branch.

Os testes do gate usam apenas fixtures sintéticas e nenhum horário fictício é divulgado como oficial.

## Gate de blobs estáticos: verificar os 256 arquivos de verdade

A validação V1 **não aceita mais só o índice** `arrivals/index.json`: quando `--require-arrivals` e `--arrivals-index` são passados, `bh_v1_release_gate` invoca `static_arrivals_reference.audit_arrivals` para abrir e conferir **todos** os 256 arquivos `00.json.gz` a `ff.json.gz`. Essa checagem é somente leitura e não mistura datasets, UI ou motor de roteamento.

Invariantes bloqueantes: esquema/versão/validade do índice, nomes e tamanhos exatos dos buckets; presença e integridade do gzip, limite de descompressão, distribuição por hash de stop_id, cobertura dos pontos com tabela, existência dos stops/linhas/serviços referenciados, array de horários ordenado, numérico e inferior a 48 horas desde a meia-noite do **dia de serviço**; igualdade do calendário estático com o calendário do catálogo. `arrivalsAudit` informa arquivos, pontos, grupos e bytes efetivamente conferidos. Não há inferência de ETA, duração de viagem ou conversão de data operacional para relógio do passageiro.

O contrato **não** comprova que os 256 buckets vieram do ZIP identificado por `source-gtfs.sha256`, nem que o GTFS continua atualizado, nem substitui testes HTTP/browser e comparação com a origem oficial. O agente principal deve integrar o comando somente depois do build concluído e antes de autorizar a promoção/publicação, com fail-closed em qualquer erro. Se o validador informar `blocked`, **não publicar** o pacote. Preservar a aba Rotas apenas como código inativo para V2, sem depender de OSM/RMBH/GPS na V1.

Testes locais desta ampliação: `python -m unittest discover -s data_quality -p 'test_*.py' -v` em checkout de testes contendo 24 casos (13 de gate + 11 de buckets) e `python -m compileall -q data_quality` — ambos passaram em Python 3.13. Os testes HTTP reais e o build estático completo **não foram executados nesta rodada**.

## Gate de equivalência da tabela municipal (22/11/2026)

Após auditar os 256 buckets, o gate agora **compara o conteúdo real** de `catalog/timetable.json.gz` (tabela GTFS municipal por parada, usada para gerar os buckets) com `dist/externo/catalog/arrivals/00..ff.json.gz`: mantém apenas uma impressão SHA-256 por stop e compara os arrays completos de horários, linha, serviço e destino. A comparação detecta horas alteradas **mesmo quando contagens e o índice coincidem**, pontos ausentes ou excedentes, duplicidades, origem gzip ausente/corrompida e buckets inconsistentes. Limites de leitura compactada/descompactada protegem a análise. O resultado `timetableAudit` inclui status, SHA-256 do **arquivo derivado** `timetable.json.gz`, contagens e motivo de bloqueio.

Comando inalterado, deve rodar **após build** com ambos `catalog/timetable.json.gz` original da mesma compilação e `dist/.../arrivals/index.json` presente:
```bash
python -m data_quality.bh_v1_release_gate catalog --date YYYYMMDD --require-arrivals --arrivals-index dist/externo/catalog/arrivals/index.json
```
Sem a tabela de origem o gate falha fechado — não usar apenas `dist/` como parâmetro de catálogo. A equivalência prova que os buckets representam o timetable local, **não** que o timetable corresponda criptograficamente ao GTFS ZIP municipal; esse vínculo oficial e os direitos de reutilização continuam como gate separado. Nenhum cálculo de rotas/ETA ou serviço metropolitano é ativado.

**Execução local desta rodada:** 36 testes em Python 3.13: 15 do gate, 11 da validação dos shards e 10 de equivalência da tabela; 36/36 passaram. Não foi realizada a validação do catálogo completo de 6,69 milhões de passagens nem homologação HTTP/mobile nesta rodada.

## Calendários GTFS com apenas exceções (22/11/2026)

O GTFS admite serviços definidos **somente** em `calendar_dates.txt` (sem `calendar.txt`). O gate municipal V1 e o monitor de vencimento agora aceitam uma inclusão `exception_type=1` de `service_id` sem entrada no calendário semanal, inclusive quando `services={}`. Em contrapartida, rejeitam a remoção `exception_type=2` de serviço inexistente e impedem dias sem serviço em todo o horizonte de homologação. Horários são sempre programados; a presença de um service_id no calendário não comprova passagem real nem vinculação ao conjunto original de viagens.

Evidência local: **49 testes** executados em Python 3.13 após os ajustes de equivalência da tabela + calendário; `compileall -q data_quality` aprovado. A base municipal completa e a compilação HTTP real seguem sem homologação nesta rodada.
