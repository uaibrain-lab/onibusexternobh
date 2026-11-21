# P23 — Pesquisa de algoritmos e aprimoramento do planejador gratuito

Data: 17/11/2026 (Belo Horizonte). Repo: uaibrain-lab/onibusexternobh.
Branch: feat/gps-worker-free-homologacao-p15-20261117. PR #19 draft.
Ainda não publicado no Pages. Hub UFMG, ru-hoje, Firebase e main intactos.

## O que Google Maps e Moovit documentam publicamente

### Google Transit / Google Maps

Google Routes API TRANSIT permite origem/destino, hora de partida OU
hora de chegada, trajetos alternativos, preferências LESS_WALKING e
FEWER_TRANSFERS, e diferentes modos de transporte. O Google Transit
recebe GTFS estático de operadores e GTFS-Realtime quando disponível
(TripUpdates, VehiclePositions, alertas). O algoritmo e os pesos
internos exatos não são integralmente públicos.

Referências:
https://developers.google.com/maps/documentation/routes/transit-route?hl=pt-br
https://developers.google.com/maps/documentation/routes/reference/rest/v2/TransitPreferences
https://support.google.com/transitpartners/answer/1335046?hl=pt-BR
https://developers.google.com/transit/gtfs-realtime/index

### Moovit

A Trip Plan API documenta Fastest, Least Walking e Least Transfers,
partida e chegada por coordenadas e filtro de modos. O produto apresenta
duração total, caminhada, transferências, instruções de embarque,
e chegada em tempo real quando a cidade dispõe de fontes adequadas.
O Moovit Assistant de 2026 menciona também avisos de conexão curta,
frequência, clima e eventos. Os pesos internos não são divulgados,
portanto não é correto alegar reprodução da fórmula proprietária.

Referências:
https://api-docs.moovit.com/
https://support.moovitapp.com/hc/en-us/articles/212011605-Plan-a-Trip-Get-Directions
https://support.moovitapp.com/hc/en-us/articles/35543186031634-Moovit-Assistant-Smarter-Trip-Planning-Than-Ever-Before

### OpenTripPlanner (OTP2) — referência aberta

OTP2 separa caminhada até a parada, transporte e caminhada de saída.
Usa Multi-Criteria Range RAPTOR no transporte, OSM/A* na malha viária,
ótimo de Pareto, custo generalizado e otimização de transferências.
Sua documentação discute folga segura de transferências e os pesos
relativos de caminhada e espera. Nosso site não roda OTP/Java:
seria necessário backend que contradiz a arquitetura estática Free.

Referências:
https://docs.opentripplanner.org/en/latest/Bibliography/
https://docs.opentripplanner.org/en/latest/RouteRequest/
https://docs.opentripplanner.org/en/latest/Version-Comparison/

## Conferência dos dados do Externo BH

As linhas 9106, 9209, 5106, 51, 9502 e 63 TODAS existem em
catalog/routes.json da branch, portanto ausência de resultado não é
necessariamente ausência de linha. O índice catalog/scan/index.json
declara 9.925 paradas, 113.692 viagens, 6.577.312 conexões e
validThrough=20261231. Isso NÃO prova cobertura idêntica à base do
Moovit. O usuário relatou 9209+5106 36 min, 9106+5106 39 min e
9106+51 45 min no Moovit, enquanto o Externo anteriormente exibia
uma combinação de 56 min e 9106+5106 de 66 min. Sem origem/destino
exatos e mesmo momento, não há comparação controlada.

## Implementações P23 no GitHub, ainda sem deploy

1. static/walk-network.js: cálculo das distâncias para múltiplas
   paradas candidatas numa só busca Dijkstra, limitada a no máximo
   160 destinos, distância limitada e teto de 30.000 expansões;
   recusa conexões impossíveis entre segmentos desconectados.
2. static/route-worker.js: pré-verificação de caminhada real de
   acesso e saída no grafo OSM ANTES de varrer o GTFS. Corrige
   distâncias estimadas em linha reta usadas na seleção preliminar.
   Ausência de rua acessível é sinalizada como walking_unavailable,
   não como ausência de ônibus. Sem grafo, mantém modo aproximado
   com aviso explícito.
3. Busca Ampliada: até 450 m / 28 candidatos nas transferências a pé
   (normal 300 m / 18); itinerário final exige validação no OSM.
   Limites distintos são cacheados sem contaminação entre modos.
4. Ranking Equilibrado opcional: custo heurístico de tempo total,
   caminhada adicional, quantidade de baldeações e risco de
   conexões com menos de 2 minutos; não modifica horários GTFS.
   Modo Mais rápido continua priorizando chegada mais cedo.
5. Filtro Pareto pós-caminhada real compara momento de chegada ou
   partida, duração total, distância a pé, número de transferências
   e risco de conexão curta; não inventa roteiros com base no Moovit.
6. Aviso de baldeação com menos de 2 minutos aparece no card
   expandido, pois pode haver risco de perder o próximo ônibus.
7. scripts/diagnose_route.cjs roda SOMENTE LOCAL, leitura do mesmo
   índice GTFS e mesmo motor Worker do app, sem API externa.
   Com foco em sequências específicas, identifica se foram geradas,
   incluídas entre candidatas, aprovadas nas caminhadas e mantidas
   após Pareto. A ausência de combinação terá diagnóstico baseado
   na fase real de exclusão, não especulação.
8. Cache PWA de homologação recebeu versão P23. O GPS padrão na
   configuração de origem continua desativado.

## Testes disponíveis, sem gastos

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
node --test tests/test_p23_street_access.cjs tests/test_p23_balanced.cjs tests/test_p23_pareto.cjs tests/test_p23_transfer_radius.cjs
~~~

Com latitude/longitude REAIS do mesmo ponto A e B da consulta no
Moovit, executar (substituir os valores ILUSTRATIVOS abaixo):

~~~powershell
node scripts/diagnose_route.cjs --from=-19.9000,-43.9300 --to=-19.8700,-43.9600 --at=2026-11-17T19:58:00-03:00 --depth=expanded --preference=fastest --focus=9209+5106,9106+5106,9106+51
~~~

As coordenadas acima NÃO são os locais reais do usuário. Uma
comparação válida precisa preservar locais, data, janela e modos
de ambos os planejadores. Ler os campos diagnostics.focus:
- generated=0: sequência não gerada a partir do GTFS disponível.
- generated>0, shortlisted=0: candidata descartada cedo.
- shortlisted>0, streetVerified=0: falhou na validação OSM/horário.
- streetVerified>0, paretoRetained=0: dominada pelas demais.
- paretoRetained>0, mas não exibida: eliminação após ordenação
  ou limite de seis resultados.

## Validação faltante e roadmap da próxima IA

- Testes completos Node/Playwright/Python, benchmark real com
  coordenadas idênticas, latência do modo ampliado e Android físico.
- A solução usa CSA-like com poda, NÃO é equivalente ao algoritmo
  RAPTOR multicritério. A poda do estado pode continuar eliminando
  alternativas válidas antes do Pareto final.
- Necessária auditoria de GTFS transfers, estações de integração,
  folga real entre veículos, entradas de imóveis, acessibilidade,
  frequência, atualizações de TripUpdates quando a fonte oficial
  existir, sempre distinguindo VehiclePositions de ETA.
- GitHub Actions recentes falharam em poucos segundos, sem etapas
  recuperáveis pelos conectores. Não afirmar CI aprovado.
- Próxima IA deve registrar commits e testes realmente executados,
  divergências encontradas, estado de deploy e validade de GTFS.
- Somente branch do Externo BH; nenhum merge ou deploy no Hub,
  Firebase, ru-hoje ou serviço pago sem autorização explícita.
