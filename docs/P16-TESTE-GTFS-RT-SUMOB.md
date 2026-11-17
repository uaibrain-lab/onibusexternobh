# P16 — Teste gratuito do GPS oficial GTFS Realtime da SUMOB

**17/11/2026. Escopo exclusivo:** uaibrain-lab/onibusexternobh.
**Estado:** implementação experimental na branch P15/P16, NÃO homologada na origem real.
**NÃO habilitar:** `static/gps-config.json` continua `"enabled":false`. Não integrar ao Hub nem a produção sem aprovação específica.

## Por que mudou

O navegador no domínio https://hubufmg.web.app não recebe os dados diretos do GPS PBH
devido à política CORS. O Worker publicado https://externo-bh-gps-free.hubufmg.workers.dev
conseguiu receber a consulta do navegador, mas a PBH retornou **HTTP 403** para
`https://temporeal.pbh.gov.br/?param=D`.

Há uma segunda fonte cadastrada como **GTFS Realtime Vehicle Positions da
Superintendência de Mobilidade Urbana de Belo Horizonte (SUMOB)**, com
URL oficial pública descrita no Transitland:

https://www.transit.land/data/feeds/f-7h2w-empresadetransportesetransitodebelohorizontes~a~rt

Licença: CC BY 4.0. Atribuição obrigatória:
"Superintendência de Mobilidade Urbana de Belo Horizonte (SUMOB)".

## Implementação de teste

- `gps-worker/src/gtfs-rt.mjs`: decodificador binário Protobuf GTFS Realtime VehiclePosition
  sem biblioteca externa, armazenamento ou serviço pago. Exige FeedHeader e versão conhecida;
  descarta coordenadas, horários e identificadores inconsistentes e deduplica registros.
- `gps-worker/src/index.mjs`: caminho somente leitura adicional
  `/api/gps?source=GTFS_RT&routes=562055,5102`; mantém as fontes legadas intactas.
  A URL de origem é FIXA no código. Não permite URL arbitrária, gravações ou dados do usuário.
  Cache de borda 25 segundos, se disponível; limite de 8 MiB, 25 mil entidades,
  1.500 veículos por consulta, 50 ids de rota.
- `scripts/check_gtfs_rt_free.mjs`: teste HTTP público de uma única consulta,
  sem deploy ou modificações; mostra HTTP, categoria do erro, status upstream,
  entidades do feed, veículos correspondentes, amostra de até 12 IDs de rota,
  quantidade de veículos sem rota, idade do fix mais recente, cabeçalho CORS
  e volume de resposta, sem listar posições/identificadores individuais.
- `tests/test_gtfs_realtime_worker.cjs`: exemplos sintéticos de Protobuf válido, corrompido,
  rota divergente, posição vencida, deduplicação e erros HTTP 301/403/429/500.

O catálogo estático do Externo possui `5102 / UFMG-Santo Antônio` e
`route_id=562055`. O primeiro teste usa os dois identificadores porque
a correspondência entre as versões de GTFS e GTFS-RT **não foi comprovada**.
HTTP 200 com `feedEntities>0` e `matchedVehicles=0` significa feed legível,
mas não prova compatibilidade de IDs ou cobertura daquela linha.

## Executar no PC — PowerShell

Não executar nenhum deploy do Hub/Firebase. Atualizar somente este repositório.

```powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
node --check gps-worker/src/index.mjs
node --check gps-worker/src/gtfs-rt.mjs
node --test tests/test_gtfs_realtime_worker.cjs
npx.cmd --yes wrangler deploy --config gps-worker/wrangler.toml
node scripts/check_gtfs_rt_free.mjs
```

O novo Worker usa o MESMO endereço `externo-bh-gps-free.hubufmg.workers.dev`.
O comando Wrangler publica somente o Worker desse projeto e não toca o outro
Worker do Hub/FUMP. Requer autenticação prévia no Cloudflare.

## 17/11/2026 — Diagnóstico de implantação (HTTP 400)

O teste público retornou `http:400, upstreamError:INVALID_REQUEST,` com
`source:GTFS_RT` e `matchingRoutes:562055,5102`.
A validação na branch aceita estes dois parâmetros. Portanto, uma versão antiga
do Worker publicado é hipótese forte; o 400 **não demonstra falha da SUMOB**.

Foi incluído `GET /api/gps/capabilities`, uma rota sem chamadas a fontes
externas. Resposta esperada após deploy atualizado:

```json
{"service":"Externo BH GPS","apiVersion":"p16-gtfs-rt-20261117-1","supportedSources":["CONVENCIONAL","SUPLEMENTAR","GTFS_RT"],"dataSourceVerified":false}
```

`check_gtfs_rt_free.mjs` agora verifica a versão antes de consultar a
SUMOB. Em caso de versão incompatível, imprime
`WORKER_DESATUALIZADO_OU_INCOMPATIVEL`, evitando um falso diagnóstico
de origem bloqueada. É necessário executar **git pull e wrangler deploy**
antes do próximo teste.

## Interpretar JSON do teste

- `http=200`, `corsAuthorized=true`, `feedEntities>0`: feed obtido
  e lido. Verificar `matchedVehicles` e `freshestFixAgeSeconds`.
- `http=200`, `matchedVehicles=0`: NÃO alegar ausência de ônibus.
  Conferir `vehicleEntities`, `missingRouteIds` e `sampleRouteIds`: permitem
  verificar IDs realmente publicados, sem expor posição/veículo individual.
  Investigar IDs GTFS-RT, período do dia, padrão de viagem e versão do GTFS.
- `http=503`, `reason=GTFS_RT_HTTP_ERROR`, `upstreamStatus=403`:
  a origem também recusou o Worker. Não tentar mascarar IP/headers ou contornar
  restrição deliberada; usar fornecedor autorizado ou hospedagem gratuita
  que tenha acesso permitido.
- `upstreamStatus=301/302`: verificar redirecionamento publicado pela fonte,
  inspecionando o destino antes de permitir redirect.
- `GTFS_RT_INVALID_PROTOBUF`: verificar tipo real da resposta,
  data e formato; nunca interpretar HTML como posições.
- `GTFS_RT_NETWORK_ERROR`, `GTFS_RT_TIMEOUT`: investigar conectividade.
- Erro 1102 Cloudflare: possível limitação de recursos ou tempo de CPU;
  conferir métricas reais da execução e reduzir consumo antes de considerar ativação.

## 17/11/2026 — Resposta REAL confirmada da Cloudflare/SUMOB

O usuário executou, no Windows PowerShell, a suíte do Worker P16:
**7 testes aprovados, 0 falhas**. Publicou em seguida
`externo-bh-gps-free.hubufmg.workers.dev`, versão Cloudflare
`d58938af-dc93-4a3b-ab98-8143991b48b6`.

A consulta `node scripts/check_gtfs_rt_free.mjs` retornou:
- `WORKER_GTFS_RT_VERSION_OK p16-gtfs-rt-20261117-1`;
- HTTP **200**, CORS `true`, sem erro upstream;
- **1.779 entidades** de telemetria, das quais 1.779 VehiclePosition;
- **7 posições** para `routes=562055,5102`, todas correspondentes ao **ID público 5102**;
- posição mais recente com **54 segundos** de idade;
- tamanho JSON filtrado de **1.796 bytes** e tempo total de requisição de **825 ms**.

O tempo total de 825 ms **NÃO** equivale ao CPU em Workers Free.
A consulta demonstrou **acesso real e parsing binário**, mas não demonstrou
compatibilidade de todas as linhas, sentido de cada veículo, CPU, taxa de falhas,
ETA ou experiência Android.

## Integração opcional da interface, após resposta real

- `static/live-gps.js`: corrigido para solicitar `source=GTFS_RT&routes=5102`
  usando **código público** da linha, não `route.id=562055` do GTFS estático.
  Não consulta `gps-nl-map.json` neste provedor; descarta posições velhas,
  inconsistentes ou de outras linhas, sem atribuir ETA/direção não confirmada.
- `static/gps-config.json`: `provider=gtfs_rt` e endpoint exato preenchidos,
  mas **`enabled=false` continua inalterado**.
- `static/app.js`: atribuição SUMOB/CC BY 4.0 quando há dados, distinção entre
  ausência de posições e ausência de ônibus; consulta periódica de 45 s
  apenas quando linha ou ponto selecionado estão visíveis e tela ativa.
- `tests/test_gtfs_realtime_adapter.cjs`: testes adicionais sobre código
  público, ausência de ETA, fonte indisponível, off-line, nenhuma posição
  reportada e reaproveitamento de requisições.
- Atualização somente na branch de desenvolvimento do Externo. Não houve
  deploy do site, alteração de Firebase, nem integração com `ru-hoje`.

Testes locais a executar após `git pull`:

```powershell
node --test tests/test_gtfs_realtime_worker.cjs tests/test_gtfs_realtime_adapter.cjs tests/test_live_gps_adapter.cjs
```

**Pendência operacional crítica:** conferir no painel Cloudflare o
`CPU time`/limites de Workers Free nas requisições reais, taxa de erro
e consumo diário. Não habilitar GPS público se o plano gratuito não sustenta
o processamento. Também validar a exibição em celulares.

## 17/11/2026 — Métricas Cloudflare do teste real (amostra pequena)

O usuário enviou PDF de Metrics/Observability do Worker publicado, janela
de 24 horas com filtro **All deployed versions** (não apenas P16).

- 23 invocações no total, distribuídas em várias versões; versão ativa
  `d58938af` tinha 2 invocações no instante do relatório.
- 4 subrequests: **3 respostas 4xx da fonte PBH antiga** e **1 resposta
  2xx da fonte SUMOB `realtime4.mobilibus.com`**.
- 0 erros de execução; 0 excessos de tempo de CPU; 0 excessos de memória.
- CPU Time **P50 0,71 ms; P90 6,95 ms; P99 7,15 ms** nas versões
  agregadas. Mediana exibida para a versão ativa: aproximadamente 0,78 ms.
- Memória **P50 1,84 MB, P90/P99 2,42 MB**.
- Limite documentado do Workers Free em 17/11/2026: 10 ms CPU por
  requisição e 100.000 invocações por dia **compartilhadas pela conta**.
- Resultado: **compatível na amostra observada, não homologação sob carga**.
  P99 agregado inclui outras versões; apenas uma consulta de fato chegou
  à fonte SUMOB. Reavaliar P90/P99, falhas de CPU e contagem diária com
  tráfego real antes de qualquer uso público em escala.

Próxima etapa: homologação separada do Hub com GPS opt-in, sem ativar
`static/gps-config.json` da branch de produção e sem modificar `ru-hoje`.
Verificar no Android a exibição de posições recentes, linha/sentido,
refresh quando visível, economia de dados e fallback GTFS. Não inferir
limite garantido de usuários a partir de apenas 23 invocações.

## Bloqueios de publicação

1. **Concluído em 17/11/2026:** teste público HTTP 200 e 7 posições da linha 5102.
2. Conferir correspondência GTFS `routes.json` ↔ feed GTFS-RT para várias linhas.
3. Conferir CPU por invocação, erro 1102, cota do Workers Free, cache e latência;
   se acima da franquia gratuita, não ativar.
4. Conferir comportamento mobile, idade dos dados e permissões CORS.
5. **Código preparado na branch:** adaptador usa 5102 e preserva fallback.
   Falta homologar em navegador/Android físico e confirmar interface mobile.
6. Verificar disponibilização HTTPS do feed, já que o URL catalogado usa HTTP.
7. Manter plataforma separada do Hub e sem cobrança automática.

O endpoint novo e o código de teste não são ativados automaticamente no site.
