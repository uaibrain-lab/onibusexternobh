# Contrato de homologação de dados — PR auxiliar

Escopo: **somente validação de dados**. O motor de roteamento, UI, GPS, transferências e produção permanecem com o agente principal (PR #19).

## Entregue nesta branch

- `data_quality/gtfs_journey_reference.py`: valida ZIP GTFS local, SHA-256 de origem, chaves, coordenadas, serviços, exceções, horários acima de 24h, monotonicidade e viagens completas com sequência de paradas.
- `data_quality/test_gtfs_journey_reference.py`: fixtures **sintéticas** e casos positivos/negativos de calendário, itinerário e integridade.
- Nenhum feed ou horário é inventado como oficial; a fixture `TESTE-1` é intencionalmente fictícia.

## Contrato solicitado ao agente principal

Consumir **somente após homologação** o retorno de `reference_journey(feed, date, trip_id, board_stop, alight_stop)`:
- `status=scheduled`: `routeId`, `tripId`, `boardStopId`, `alightStopId`, `boardSeconds`, `alightSeconds`, `stopCount`, `sourceSha256`, `scheduledNotRealtime=true`.
- `status=missing_trip|inactive_service|missing_ordered_stops`: lacuna de cobertura, **não** autorização para ETA ou itinerário inferido.
- `boardSeconds/alightSeconds` são segundos desde meia-noite do **dia de serviço GTFS**, podendo exceder 86400. Não converter para data/hora civil sem respeitar timezone da agência.
- `route_id` e `route_short_name` são distintos; nunca juntar feeds municipais e metropolitanos somente pelo nome curto da linha. Prefixar com ID de fonte no catálogo integrado.
- O validador **não** calcula transferências, GPS ou viagens multimodais; o roteador é dono desses contratos.

## Como executar quando o checkout estiver disponível

```bash
python -m unittest discover -s data_quality -p 'test_*.py' -v
python -m data_quality.gtfs_journey_reference /caminho/GTFSBHTRANS.zip --date 20261124
```

O segundo comando apenas demonstra a interface; a data precisa ser escolhida conforme o período de validade do feed efetivamente baixado.

## Bloqueios de homologação oficial

1. Ainda não foram ingeridos os arquivos `itinerario_rmbh.txt` e `quadro_horario_rmbh.txt` do usuário nesta branch; é preciso obter bytes e esquema de campos com origem/licença, sem publicar dados não autorizados.
2. Não foi executada jornada real BH/RMBH com trip/stop IDs comprovados de fonte oficial. Sem esse teste, não marcar cobertura de origem/destino como aprovada.
3. O terminal isolado desta execução não resolveu `github.com` via DNS; alterações foram feitas pelo conector autenticado. Os testes de Python desta branch **ainda não foram executados**.
4. A integração do contrato no roteador pertence ao agente principal; esta branch não edita arquivos do principal.

**Critério de aprovação futuro:** testes sintéticos verdes + checksum da fonte oficial + licença/validade identificadas + ao menos uma jornada completa real por fonte, com todas as paradas e horários comparados ao GTFS/DER de origem, sem transferências inferidas.

## Interface adicional DER RMBH (homologação 22/11/2026)

`der_rmbh_reference.read_itineraries(path)` e `read_departures(path)` produzem apenas linhas brutas e saída de auditoria (`coverage(...)`). **Não são uma fonte GTFS, um roteador nem uma lista de chegadas por parada.** O agente principal não deve converter `clockSeconds` em horário para embarque intermediário: representa exclusivamente `HORA_PARTIDA` do quadro, sem definição oficial de parada inicial ou dia civil. Preservar `COD_LINHA + NUM_LINHA`, `TIPO_DIA`, `NOME_QUADRO` e sufixos sem equivalência automática para `route_id/trip_id/stop_id`.

Resumo rastreável, limites, hashes e comandos: [DER_RMBH_AUDIT_20261122.md](DER_RMBH_AUDIT_20261122.md). Ambos os TXT permanecem somente no ambiente de testes; nenhum arquivo bruto foi incluído no PR. A publicação dos dados e a integração ao planejador continuam bloqueadas pela ausência de licença/validade verificada, geocodificação, calendários equivalentes e horários de passagem por parada.
