# P15 — GPS público exclusivamente gratuito e QA integrado mobile

**17/11/2026 · escopo restrito a `uaibrain-lab/onibusexternobh`.**

Nenhum commit em `ru-hoje`, nenhum deploy em Firebase/Cloudflare, nenhuma mudança nas branches-base ou na `main`. Esta fase é uma preparação **opt-in**, não uma afirmação de GPS público homologado.

## O que foi implementado

- `gps-worker/src/index.mjs`: leitor **somente GET** dos feeds públicos fixos PBH `https://temporeal.pbh.gov.br/?param=D` e `?param=SD`. Cloudflare Workers Free, sem KV/D1/Cron/VPS/Blaze ou API comercial; origem/CORS fixa para o Hub, validação estrita de NL, tamanho de feed até 12 MiB, resposta de no máximo 1.500 observações e filtro de idade/latitude/longitude. Retorna HTTP 503 sem dados fictícios se a origem falhar.
- `gps-worker/wrangler.toml`: Worker independente do proxy da FUMP; **não foi publicado**. Cache temporário de 25 segundos por POP, se Cache API disponível, sem armazenamento permanente de identificadores de usuários.
- `static/live-gps.js`: adaptador opcional da versão estática que carrega `catalog/gps-nl-map.json` **somente ao consultar uma linha**, cruza NL com `routeIds` do GTFS e devolve apenas posições frescas e compatíveis. Nenhuma latitude/longitude do passageiro é enviada ao Worker.
- `static/gps-config.json`: `enabled:false` por padrão. O app mantém pontos/linhas/horários/roteamento sem GPS.
- `static/static-bus.js` e `static/app.js`: exibem posições PBH por linha somente se houver fonte pública válida; **ETA do GPS NÃO é calculado nem prometido neste modo**, pois a viagem e a variante do veículo ainda não têm confirmação suficiente. O horário mostrado no ponto continua sendo de tabela GTFS.
- `scripts/build_static_site.py`: inclui o adaptador e o mapa NL no build estático versionado. `static/service-worker.js`: adiciona somente arquivos públicos do shell ao cache versionado; nunca armazena respostas GPS ou tiles.
- `scripts/check_gps_free.mjs`: verificador de conectividade, CORS, total de respostas, tamanho e latência após implantação externa.
- `scripts/audit_static_budget.py`: valida pacote, GTFS compatível, limites de blocos, custo de transferência compartilhado e impede GPS habilitado sem `--allow-live`.
- `tests/test_gps_worker_free.cjs`, `tests/test_live_gps_adapter.cjs`, `tests/test_gps_integration_contract.cjs`: regressões sintéticas.
- `tests/browser-p15.spec.cjs`: regressões de navegação, área de toque >=44 px e métricas transferidas/memória; execução Playwright real prevista no workflow.

## Por que não habilitamos ainda o Worker

A origem PBH é oficial e seus feeds D/SD já são usados pelo servidor Python local. **Não foi possível confirmar neste ambiente a resposta efetiva da PBH a partir de um POP Cloudflare Free**, nem limites reais de CPU, cache, CORS e falhas por região. Portanto, **`enabled:false` permanece obrigatório**.

Cloudflare Workers Free possui franquia de requisições e limite de CPU por chamada: o processamento de feeds JSON grandes precisa ser medido no serviço real antes de ativar. CORS apenas limita browsers; não constitui proteção contra clientes que falsifiquem Origin. A fonte deve continuar com controle de chamadas por cache e limites rígidos de tamanho.

### Homologação futura do acesso público (sem serviços pagos)

1. Validar política de redistribuição dos dados PBH e estabilidade/cotas dos feeds D e SD.
2. Implantar o Worker **separado** na conta Cloudflare Free explicitamente autorizada:
   `npx wrangler deploy --config gps-worker/wrangler.toml`
   (não altera o Worker FUMP nem o Hub).
3. Executar no dispositivo/ambiente que consiga acessar o endpoint:
   `node scripts/check_gps_free.mjs --worker=https://SEU-WORKER.workers.dev/api/gps --source=CONVENCIONAL --nls=393`
4. Validar: HTTP 200, CORS para a origem real, timestamp GPS fresco, registros por NL, resposta compacta, ausência de confusão de sentidos, resposta 503 segura na falha e cache efetivo entre chamadas.
5. Medir CPU por requisição, volume de download e gasto de Workers Free em horário de pico. Se não couber nas cotas, o GPS **não deve ser habilitado**.
6. Só então alterar a cópia de configuração `static/gps-config.json` (`enabled:true`, `endpoint` HTTPS terminando `/api/gps`) para um ambiente de staging independente. **Não publicar no Hub antes da homologação final**.

## Comandos de QA completos (sem deploy)

```bash
python -m unittest discover -s tests -v
python -m compileall -q server.py transit tests scripts
node --check static/app.js
node --check static/static-bus.js
node --check static/static-arrivals.js
node --check static/live-gps.js
node --check gps-worker/src/index.mjs
node --test tests/test_*.cjs
python scripts/build_static_site.py
python scripts/audit_static_budget.py --root dist/externo
python -m http.server 8765 --bind 127.0.0.1 --directory dist
# Em outro terminal e com Playwright instalado:
npx playwright test --config=tests/playwright.config.cjs
```

O browser precisa de suporte a `DecompressionStream('gzip')` para os índices, ou fallback documentado. O calendário GTFS tem validade até **31/12/2026**: nunca extrapolar viagens fora da validade.

## Evidência real disponível e limitações

- Verificação de sintaxe isolada da branch P15 em V8: app, StaticBus, StaticArrivals, StaticLive, SW e Worker compilaram.
- Testes sintéticos executados em V8: Worker filtra NL, rejeita origem/parâmetros inválidos e falha com 503; adaptador cruza duas fontes com o NL da linha, sem mostrar ETA fictício.
- Um artefato antigo de preview **P9** de GitHub Actions foi baixado para inspeção local (123,49 MiB; índice de rotas 110,30 MiB; rede caminhável 5,83 MiB). Ele **não contém a P15** nem os novos buckets de chegadas.
- Navegação por **Chromium em modo de emulação via HTML e GTFS incorporados em memória**, com larguras 350, 390 e 1365 px, abriu as quatro abas e não apresentou overflow horizontal na P9. Na P9 antiga a altura das abas era ~35 px; o CSS da versão integrada P14 já especifica mínimo de 44 px, porém necessita confirmação visual no build P15.
- As medidas de heap obtidas com GTFS embutido no HTML são **artefato do harness** e NÃO equivalem à memória do aplicativo implantado. A navegação HTTP local do Chromium foi negada pelo administrador do ambiente, inclusive para URLs interceptadas. **Não é teste em Android físico**, nem teste de rede móvel/3G.
- GitHub Actions da branch-base de integração e da revisão P15 encerram com `steps=null` antes dos testes. Sem log de execução, causa não comprovada. Não declarar suíte Python/JS/Playwright verde sem execução.

## Benchmark preliminar de CPU (não é homologação do Cloudflare)

Uma simulação local de JSON PBH no Node 22 deste ambiente (análise de JSON + filtro de NL) produziu mediana aproximada de **12,6 ms para 0,88 MiB / 10.000 registros**, **35,9 ms para 2,67 MiB / 30.000** e **50,8 ms para 5,35 MiB / 60.000**. Isso é **wall time do Node em ambiente compartilhado**, e **não** CPU do Worker Cloudflare; os dois números não são comparáveis como equivalentes. O resultado revela risco material de exceder os **10 ms de CPU do Workers Free** se a PBH enviar feeds grandes. Não presumir compatibilidade com a franquia.

O script `node scripts/benchmark_gps_parse.mjs` executa o próprio handler Worker com feeds simulados para obter uma medição local reprodutível. Só o teste no POP real do Cloudflare, com tamanhos reais da PBH e verificação de cache, pode autorizar `enabled:true`. Em caso de excesso, **priorizar alternativa gratuita tecnicamente comprovada ou manter GPS indisponível**, jamais exigir serviço pago.

A origem oficial PBH publica os dados de localização em formato aberto sob Creative Commons Atribuição: https://dados.pbh.gov.br/pt_BR/dataset/tempo_real_onibus_-_coordenada. Disponibilidade, volume, limites de tráfego e permissões efetivas da origem precisam ser testados novamente no ambiente de execução.

## Risco de franquia Spark

Documentação: Firebase Hosting Spark prevê franquia compartilhada com o restante do Hub de aproximadamente 10 GiB/mês de transferência e até 10 GiB de armazenamento; Cloudflare Workers Free impõe limite de 100 mil requisições/dia e CPU limitada. **Zero cobrança obrigatória, mas também zero garantia de capacidade ilimitada.**

O índice horário da P9 já soma ~110 MiB no pacote; carregamentos são por hora, não todos de uma vez. O novo catálogo de chegadas adiciona ~18,3 MiB em buckets preguiçosos. `scripts/audit_static_budget.py` registra os tamanhos e capacidades hipotéticas de sessões, sem prometer usuários suportados. Uma pesquisa que transfere 18 MiB equivale teoricamente a ~568 sessões antes de 10 GiB, **sem considerar outras seções do Hub**, repetição de dados ou caches.

## Critérios que ainda bloqueiam publicação

- Demonstrar origem PBH realmente acessível por Cloudflare Worker gratuito, CPU/cache e CORS medidos.
- GitHub Actions executar testes (Python + Node + build + HTTP + Playwright) no mesmo commit.
- Testar fluxo real em Android intermediário, com 350–390px, navegador e rede móvel, inclusive sem conexão.
- Comparar horários GTFS e itinerários reais em campo; não anunciar precisão global quando o roteador sinaliza resposta parcial.
- Publicar GTFS/scan/arrivals/caminhadas pelo mesmo fingerprint oficial, com rollback confiável.
- Não ativar serviços pagos, não trocar o plano Spark e não tocar no repositório Hub.
