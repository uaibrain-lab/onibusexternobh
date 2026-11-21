# P26 — Correção de baldeações densas, margens seguras e diagnóstico OSM

Data: 17/11/2026, após medições P25B no Windows.
Repo exclusivo: \`uaibrain-lab/onibusexternobh\`.
Branch: \`feat/gps-worker-free-homologacao-p15-20261117\`.
**Não publicado:** não houve deploy do Pages, Worker, Firebase nem Hub por esta fase.

## Evidência reprodutível do usuário

Comparação do Google Maps com motor Externo BH, tendo como referência
uma consulta noturna em BH:

| Itinerário | Google | Motor anterior |
|---|---:|---|
| 9209+411C | chega 23:12 | 411C fora do GTFS municipal (DER/MG) |
| 9209+51 | chega 23:18 | não gerava |
| 9106+5106 | chega 23:23 | gerava 7, **0 passavam grafo OSM** |
| 9209+67 | chega 23:30 | não gerava |
| melhor | 23:12 | 9209+5250 às 23:16 |

A medição do usuário descobriu que elevar apenas os vizinhos de
baldeação de 28 para 90 (sem mudar raio 450 m) recuperou 9209+51
às 23:07; 8,9s → 9,0s em Node. **Essa alternativa tem uma conexão
provavelmente inviável**: 495 m / 7min46s a pé entre Avenida Amazonas
e Estação Rio de Janeiro plataforma 1B, apenas 52 segundos livres.
O HAR do Moovit registra uma passagem de estação de 63 segundos; NÃO
é evidência do tempo de acesso desta estação específica.

**Não afirmar paridade com Google** com base nesta medição. Verificar
mesmas coordenadas, dia, horário e fonte oficial GTFS, e se a
caminhada/percurso é fisicamente possível.

## Defeitos concretos corrigidos

1. **Recorte espacial viesado**: \`nearby()\` usa 16 direções e 3 bandas
   para amostrar paradas diversas somente quando \`limit>=40\`.
   Antes, \`neighbors()\` usava 18/28 e, portanto, a diversidade
   NUNCA era ativada nas baldeações. Agora, \`neighbors()\` pede
   48 paradas no modo Normal (raio 300 m) e 90 no Ampliado
   (raio 450 m). A distância das paradas candidatas continua ordenada;
   a verificação de ruas OSM permanece obrigatória.
2. **Acesso apertado**: a margem de embarque inicial mantém 45s,
   mas sobe para 105s quando o ponto se chama Estação/Terminal/
   Plataforma/MOVE. Baldeações reservam 120s após a caminhada;
   se a caminhada conecta uma estação, reservam 180s.
   São margens conservadoras heurísticas — NÃO tempos GTFS
   \`pathways.txt\` nem estimativas exatas de plataforma.
   Aplicadas no scan forward, backward e na verificação após caminhos
   OSM. Uma conexão com apenas 52s após 7m46s de caminhada é
   **descartada**, não promovida a “melhor trajeto”.
3. **Diagnóstico de inviabilidade**: chamada offline com
   \`diagnostics:true\` agora inclui \`rejectedWalkReasons\` e
   \`focus[].streetRejectionReasons\` (sem lat/lng nos relatórios),
   separando \`streetPathUnavailable\`,
   \`insufficientTransferMargin\`,
   \`missingWalkingCoordinates\`,
   \`invalidWalkingSequence\`, \`invalidJourneyWindow\`.
   Assim, o 9106+5106 pode ser investigado sem alegar “sem rota”
   quando o grafo OSM, e não a tabela, descarta candidatos.
4. **Memória mobile**: listas de 90 vizinhos não podem permanecer
   para até 20 mil paradas, pois comprometeriam RAM. Cache limitado
   a 2.500 listas com descarte FIFO individual.
5. **Cache bust PWA**: versão de build homologação P26 e shell
   Service Worker v6, sem alteração de configuração GPS pública.
6. **Gates automatizados**: \`tests/test_p26_transfers_station_access.cjs\`
   testa 170 pontos densos de um lado + 24 candidatos de outras
   direções; margens de estação, reprovação de 52s e aprovação de
   conexão confortável. Integrado ao script PowerShell e ao watch
   GitHub Actions. Atualização do teste P23 de limites para 48/90.

## Verificações executadas vs pendentes

Executadas pelo assistente, de forma isolada por V8:
- sintaxe do \`route-worker.js\` — OK;
- normal: 47 vizinhos (excluído próprio ponto), 12 de outros corredores;
- ampliado: 89 vizinhos, 24 de outros corredores;
- margem inicial 105s, transferência 120s, acesso estação 180s;
- transferência estação com 52s de folga reprovada;
- transferência com 204s de folga aprovada.

**Não executadas ainda na mesma revisão:** suíte completa Node,
build Python do site, Playwright, benchmark real 9209+51 após
descartar a conexão apertada, memórias e latência Android.
Github Actions pode rodar automaticamente, mas só considerar
aprovado se verificar o resultado; não confundir push com CI.

## P25B: fonte TripUpdates é compatível com GTFS oficial baixado, MAS
## a versão do aplicativo não é a mesma

O usuário comprovou no diagnóstico do feed:
- 638 TripUpdates; matchedTripId=638 e unmatchedTripId=0;
- 594 **trip_id distintos** encontrados no GTFS estático;
  638 mensagens podem referir instâncias diferentes da mesma viagem;
- routeMatchesPublicCode=638; routeMatchesStaticId=0;
- directionMatches=638; directionMismatch=0;
- matchedStopKey=637; unmatchedStopKey=1;
- withStartDate=638 e withStartTime=638;
- atraso mediano +139 segundos, mínimo −2355 e máximo +1798;
- FeedHeader atualizado havia 16 segundos, sem timestamp individual;
- **matchesAppCatalogSourceGTFS=false**. Não presumir que o
  aplicativo usa o GTFS mais recente nem que o ZIP atual é
  automaticamente seguro para substituição. Comparar os
  sha256 e a versão/fonte do build antes de qualquer integração.

Resultado: tecnicamente promissor para atrasos oficiais, mas **ainda
não adicionar previsão ao PWA**. Precisamos validar as instâncias
por start_date/start_time e calendário e reconstruir o catálogo de
forma atômica a partir de GTFS oficial validado. Não basta que o código
público da linha coincida. Sem timestamp individual, identificar
se informação operacional está realmente recente exige cautela.

## Pendências de maior valor

1. Rodar \`node scripts/diagnose_route.cjs\` com as coordenadas
   e mesmo horário do Google/Moovit (não usar coordenadas de exemplo
   como benchmark), incluindo foco \`9106+5106,9209+51,9209+67\`.
   Inspecionar \`streetRejectionReasons\` detalhadas. Se ocorrer
   \`streetPathUnavailable\`, testar grafo, snapping e se a rota
   real excede o limite de 800m por transferência; não inventar
   travessias de vias ou caminhos diretos.
2. Integrar dados metropolitanos DER/MG para 411C, 511C
   **somente após** obter horários de passagem por parada e sentido,
   ou estimativas rotuladas honestamente quando a fonte não fornecer.
3. Validar original GTFS \`pathways.txt\` e \`transfers.txt\` (quando
   presentes), melhorar tempos reais de acesso por plataforma.
4. Testar performance no Android PWA: 48/90 vizinhos aumentam
   combinações no scanner mesmo que em Node o aumento com 90 tenha
   sido pequeno no caso do usuário.
5. Finalizar verificação de fonte GTFS e compatibilidade TripUpdates
   por instância, e somente depois criar leitor RTC sem serviço pago.
6. Verificar CI/Playwright, gerar build novo, homologar antes de deploy.

## Comandos no Windows (somente validação local)

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
node --test tests/test_p23_transfer_radius.cjs tests/test_p26_transfers_station_access.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Publicar-GPS-Homologacao.ps1"
~~~

Não usar \`-ReutilizarBuild\` após alterar \`route-worker.js\`: o
script compara SHA-256 e rejeita pacote de versão anterior.
Não publicar via \`-Publicar\` sem testes completos e
benchmark de rotas atualizado.

Próxima IA: registrar commits SHA, resultados reais de testes,
benchmarks com mesmos dados e datas; investigar 9106+5106 com
diagnósticos OSM, e manter essas informações atualizadas.
