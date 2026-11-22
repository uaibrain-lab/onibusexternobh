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

## Gate opcional de procedência do ZIP municipal (22/11/2026)

`data_quality/bh_v1_source_provenance.py` valida em **somente leitura** os bytes de um ZIP GTFS municipal local contra `catalog/source-gtfs.sha256`, os IDs e códigos de linhas, paradas e coordenadas, viagens `trip_id/route_id/service_id`, calendários semanais e exceções, `feed_info` quando existir, e contagens e referências de `stop_times`. Faz streaming da tabela grande, com limite de tamanho comprimido/descomprimido e rejeição de entradas ZIP inseguras. Horários acima de 24h são válidos; horários iguais ou acima de 48h bloqueiam esta versão, pois o exportador V1 filtra esses registros e poderia deixar passagens de fora.

Comando de homologação estrita (o ZIP deve ser o mesmo usado na construção do catálogo):
```bash
python -m data_quality.bh_v1_release_gate catalog --date YYYYMMDD --require-arrivals --arrivals-index dist/externo/catalog/arrivals/index.json --require-source-zip --source-zip /caminho/GTFSBHTRANS.zip
```
A ausência do ZIP quando requerido bloqueia o gate. Sem os argumentos, o gate anterior continua funcionando para consultas locais. Saída `sourceAudit` contém SHA-256 recalculado, contagens, falhas e **`licensedForRedistribution=unverified`** até prova documental. A correspondência do ZIP com o hash registrado prova identidade de bytes, não a licença, autenticidade da origem ou que horários publicados equivalem a observações em campo. A equivalência completa de horários entre `timetable.json.gz` e os buckets é verificada por outro gate do mesmo PR.

**Evidência desta etapa:** 64 testes Python 3.13 com fixtures sintéticas executados com sucesso, além de `compileall -q data_quality`. O arquivo GTFS oficial completo não estava disponível no executor local: **a comparação de 6.691.004 passagens do ZIP real não foi executada**. O agente principal deve introduzir a opção estrita no pipeline após obter o mesmo ZIP do build, sem editar esta branch nem presumir licença verificada. Rotas, RMBH, UI, GPS e produção permanecem fora do escopo.


## Gate estrito: equivalência do ZIP GTFS ↔ timetable ↔ buckets (22/11/2026)

Nova etapa `bh_v1_zip_timetable_equivalence.py`: para o comando de homologação **com as duas flags obrigatórias** `--require-source-zip` e `--require-arrivals`, além de validar o SHA-256 do ZIP e os 256 buckets, o gate agora confere linha por linha cada `stop_time` do ZIP municipal com `catalog/timetable.json.gz`. A comparação utiliza exatamente as chaves do exportador existente: `stop_id`, código público da linha, `service_id`, `trip_headsign` e segundos desde a meia-noite do dia de serviço. Registros duplicados (mesmo stop, linha, serviço, destino e segundo) são consolidados, como faz `build_timetable.py`; grupos sem horários, segundo inválido, registros de stop ausentes/excedentes, calendários trocados e diferenças silenciosas são bloqueados.

Processa os registros de origem em um banco SQLite temporário com índice, sem guardar milhões de `stop_times` em RAM; os dados temporários são descartados ao terminar. A inspeção completa pode consumir armazenamento temporário, disco e CPU proporcionais ao feed — medir o custo real na CI antes de ativar o gate sobre toda atualização. O resultado `zipTimetableAudit` contém contagens, diferenças e até dez stop_ids de amostra. **Não** cria viagens, ETAs ou rotas.

Comando de aprovação de V1 (o ZIP, o timetable e os buckets precisam vir da mesma compilação):

```bash
python -m data_quality.bh_v1_release_gate catalog --date YYYYMMDD --require-arrivals --arrivals-index dist/externo/catalog/arrivals/index.json --require-source-zip --source-zip /caminho/GTFSBHTRANS.zip
```

Os outros modos de auditoria permanecem disponíveis sem o ZIP quando não se trata de aprovar a publicação. Não confundir integridade de bytes com verificação da origem oficial, licença ou pontualidade do ônibus.

**Evidência executada no ambiente local desta rodada:** 80 testes sintéticos de `data_quality/` aprovados em Python 3.13 (`python -m unittest discover -s data_quality -p 'test_*.py' -q`) e `compileall -q data_quality` aprovado. Limite atual: ainda **não** foi executada a auditoria completa sobre os 6.691.004 registros do GTFS oficial porque o ZIP de origem não estava disponível no container. Nenhuma alteração fora de `data_quality/`.


## Integridade de sequência por viagem no ZIP municipal (22/11/2026)

Novo validador `data_quality/bh_v1_trip_sequence.py` conectado à leitura **já existente** de `stop_times.txt` em `bh_v1_source_provenance.py`, sem novo scan e sem usar disco adicional. Rastreia apenas a sequência, última hora de partida e contagem por `trip_id`. Rejeita: `stop_sequence` duplicado ou decrescente, chegada anterior à partida da parada anterior, viagens com uma única parada, viagens sem horários e blocos não contíguos de `trip_id` (exigência do importador municipal atual `scripts/update_gtfs.py`). Reconhece horários acima da meia-noite conforme a tabela GTFS.

O resultado `sourceAudit.tripSequenceAudit` registra contagens e códigos de bloqueio. Essa auditoria cobre **ordenamento das linhas no arquivo recebido para o importador atual**; não pretende declarar que todos os GTFS públicos ordenam obrigatoriamente os CSV por viagem. Caso a SUMOB forneça um feed GTFS válido fora da ordem exigida pelo nosso importador, a V1 deve adaptar primeiro o importador e sua homologação, não aprovar silenciosamente um catálogo incoerente. Nenhum motor de rotas/itinerários/metropolitanos foi alterado.

**Validação nesta rodada:** 11 testes unitários do novo validador, executados localmente com `unittest` e `compileall` aprovados. Quatro cenários de integração no ZIP sintético foram acrescentados em `test_bh_v1_source_provenance.py`, mas esses quatro **ainda não foram executados neste ambiente**. A auditoria do ZIP municipal real completo permanece pendente.
