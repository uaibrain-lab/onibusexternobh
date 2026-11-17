# P5 — Motor de planejamento de viagens (protótipo; sem deploy)

Branch de desenvolvimento: feat/externo-p5-planejador-20261117, baseada na P4. Não modifica main ou o Hub publicado.

## Entregas

- Aba **Rotas**: origem/destino por GPS com consentimento, clique no mapa ou busca manual de endereço.
- Horário: sair agora, partir em data/hora ou chegar até determinada data/hora, com margem opcional.
- Itinerários municipais a partir de viagens reais do GTFS: trip_id, service_id, sequência de paradas, horários, calendários e exceções.
- Busca temporal para frente (departAt) e para trás (arriveBy); até três embarques (duas baldeações).
- Preferências: fastest, leastWalking, leastTransfers.
- Conexões em paradas coincidentes ou até 165 m em linha reta. Caminhada marcada como estimativa sem percurso por ruas.
- Sugestões de metrô entre estações próximas e ativas, SEM horários inventados e SEM classificar junto aos ônibus.
- Busca de endereços por Nominatim exclusivamente sob ação explícita, sem autocomplete, com cache 24h e limitação de 1 chamada a cada 1,15 s por processo.

## Índice GTFS

O timetable da P3 agrupa horários por parada e linha, perdendo a identidade da viagem. Não permite confirmar o sentido ou o horário em paradas seguintes.

A P5 cria:
- catalog/routing-index.json — serviços, exceções, validade e fontes.
- catalog/routing-stops.json — paradas da mesma versão GTFS.
- catalog/routing-stop-routes.json — linhas servindo cada parada.
- catalog/routing/*.jsonl.gz — cada viagem e cada passagem, em arquivos compactados por linha.

Gerar com:

    py -3 scripts\build_routing.py "D:\Downloads\GTFSBHTRANS.zip" catalog
    py -3 -m unittest discover -s tests -v
    py -3 server.py

Abra http://127.0.0.1:8765/externo/ e selecione Rotas.

A rotina GitHub Actions em .github/workflows/build-routing.yml baixa o GTFS PBH e gera os índices na branch P5; nenhum deploy é executado. Revalidar a data de validade a cada atualização.

## API

- GET /externo/api/plan/status: prontidão do índice.
- GET /externo/api/places?q=ENDERECO: busca explícita de endereço.
- POST /externo/api/plan: JSON de até 4096 bytes, contendo:

    {
      "origin":{"lat":-19.8695,"lng":-43.9675},
      "destination":{"lat":-19.918,"lng":-43.938},
      "at":"2026-11-18T07:30:00-03:00",
      "mode":"departAt",
      "preference":"fastest"
    }

mode = departAt ou arriveBy; preference = fastest, leastWalking ou leastTransfers.

A resposta apresenta as linhas, sentidos, pontos de embarque e desembarque, transferências e horários GTFS. As sugestões de metrô ficam em metroHints, apenas informativas. O status partial significa que a pesquisa alcançou um limite computacional e NÃO garante a melhor rota global.

## Limitações obrigatórias

1. Caminhadas NÃO são trajetos georreferenciados pelas ruas. Distâncias são aproximações geométricas; não prometem travessia possível, acessibilidade nem percurso real.
2. GPS dos ônibus NÃO está associado aos trip_id do GTFS com confiança suficiente. Horários programados NÃO são ETAs em tempo real.
3. Linhas e paradas são limitadas por consulta para evitar sobrecarga. Se o limite for atingido, o resultado é partial.
4. Metrô SEM grade de viagens validada: impossível ordená-lo precisamente com ônibus ou comprovar uma baldeação por horário. A P5 fornece sugestões indicativas e consultas oficiais.
5. Nominatim público NÃO é infraestrutura adequada para alto volume. Para produção, substituir por geocodificador em infraestrutura própria ou com licença adequada.
6. Backend Python não é executado no Firebase Hosting Spark estático. Não realizar deploy sem definir infraestrutura e cache.
7. A versão ideal exigirá rede de pedestres OSM, conexões confirmadas, indicadores de incerteza, GTFS-RT com trip_id verificado e testes de campo.

## Testes

tests/test_planner.py cria GTFS sintético com rota direta mais lenta que duas linhas integradas, viagem no sentido contrário, busca reversa, exceção de calendário, datas vencidas e inexistência do índice.

Esta é uma entrega de roteamento programado de ônibus, com metrô informativo. Não afirmar paridade de precisão com Moovit/Google Maps antes da homologação.