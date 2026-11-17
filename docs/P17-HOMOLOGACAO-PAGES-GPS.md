# P17 — Homologação gratuita do Externo BH com GPS SUMOB

**Escopo:** somente `uaibrain-lab/onibusexternobh`, branch
`feat/gps-worker-free-homologacao-p15-20261117`. Não publicar no
`ru-hoje`, não alterar Firebase Hosting/Hub, não mesclar em `main`,
não usar Blaze nem plataformas com cobrança obrigatória.

## Estado verificável em 17/11/2026

- A fonte oficial GTFS Realtime SUMOB foi consultada pelo Worker Cloudflare:
  HTTP 200, 1.779 entidades GPS, 7 veículos da linha pública **5102**,
  observação mais recente com 54 s; 17 testes Node de componentes passaram.
- Painel Cloudflare: 23 invocações em todas as versões (não somente P16);
  CPU P50 0,71 ms / P90 6,95 ms / P99 7,15 ms e nenhum excesso de limite
  na amostra. Dados insuficientes para prever tráfego ou lotação diária.
- O app estático consulta a SUMOB pelo **código público** (por exemplo 5102),
  e não pelo ID interno do GTFS estático (por exemplo 562055).
- `static/gps-config.json` continua **enabled: false** no código-fonte.
  A opção `--gps-staging` habilita o GPS **somente na cópia construída
  em dist/externo/gps-config.json**.
- O Pages de homologação **ainda não foi publicado** por esta fase.
  A URL abaixo é o **destino planejado**, não uma disponibilidade confirmada.

## Infraestrutura gratuita e isolada

- Cloudflare Worker Free já existente:
  `https://externo-bh-gps-free.hubufmg.workers.dev/api/gps`.
  Fonte fixa `GTFS_RT` com resposta limitada e cache de ~25 s por POP.
- Novo projeto Cloudflare Pages **somente para homologação**:
  `externo-bh-hml-uaibrain`, branch de produção isolada `hml-gps`.
  URL planejada:
  `https://externo-bh-hml-uaibrain.pages.dev/externo/`.
- CORS do Worker permite **somente** os dois domínios existentes do Hub e
  esta origem exata do Pages; nenhuma permissão `*.pages.dev` ou `*`.
  **O Worker precisa de um novo deploy explícito para aplicar essa adição**.
- O build exclusivo de homologação inclui `_headers` com noindex,
  `_redirects` na raiz, indicação **TESTE** visível no status,
  e aviso de GPS experimental. Não torna o Pages privado; quem souber
  a URL pode acessar a versão de teste. Não use dados sensíveis nela.
- O GTFS, o planejamento de rotas e os horários permanecem totalmente
  estáticos, sem cobrança de backend. Sem ETA GPS inventado, sem banco.

## Primeira publicação isolada — PowerShell 5.1

Requisitos: Git, Node.js, Python 3 e Wrangler autenticado no Cloudflare,
conta no plano Free, pasta local já clonada em `D:\Downloads\Externo-GPS-Teste`.

Atualize e publique **somente no projeto de homologação**:

```powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117

powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Publicar-GPS-Homologacao.ps1" -AtualizarWorker -CriarProjeto -Publicar
```

O script:
1. Confere o repositório/branch permitidos e se a origem do GPS ainda está
   desativada.
2. Executa testes Node e testes Python isolados de dois perfis de build.
3. Gera `dist/externo/` com GPS ativo apenas para homologação;
   não edita arquivo do código-fonte; valida noindex, branding e limites
   gratuitos de 20 mil arquivos e 25 MiB por arquivo.
4. Com `-AtualizarWorker`, publica **somente** o Worker de GPS com CORS
   adicional. Sem esta opção, a publicação Pages exige que CORS já esteja
   autorizado; caso contrário, o script falha de modo seguro.
5. Com `-CriarProjeto`, cria o projeto Pages independente se ele ainda não
   existir. Em futuras publicações, não use essa opção.
6. Com `-Publicar`, executa apenas
   `wrangler pages deploy dist --project-name externo-bh-hml-uaibrain --branch hml-gps`.
   Não publica `ru-hoje`, Firebase nem outro Worker.

**Se o projeto Pages já existir:** reexecute somente com `-Publicar`
(e `-AtualizarWorker` se for necessário atualizar CORS). Caso o nome
esteja indisponível, **não improvise outro nome de projeto**: primeiro
altere de forma coordenada o CORS estrito do Worker, o script e o URL do build.

**Para compilar e testar localmente sem nenhum deploy:**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Publicar-GPS-Homologacao.ps1"
python -m http.server 8765 --directory dist
```

Acesse `http://127.0.0.1:8765/externo/`. O GPS real pode ser bloqueado por
CORS no localhost: esse é um teste local visual e de funcionalidades estáticas.
Para testes E2E de interface com dados simulados, execute em outro terminal:

```powershell
npx.cmd --yes playwright test tests/browser-p17-gps-staging.spec.cjs --config=tests/playwright.config.cjs
```

O teste E2E intercepta GPS com uma resposta sintética, sem consumir Worker e
sem representar homologação de posições reais. Ele requer Playwright instalado
e navegador Chromium disponível. O comando é só para ambientes preparados para
Playwright; se faltar, instale os requisitos de teste seguindo o workflow P9.

## 17/11 — Recuperação após falha PowerShell/CORS

Primeira execução de `Publicar-GPS-Homologacao.ps1 -AtualizarWorker
-CriarProjeto -Publicar`: **18 testes Node, 4 testes Python,
build de 141,13 MiB / 496 arquivos, config pública desativada OK**.
Worker atualizado para `889bc033-d877-4069-954b-ea18a790f171`.
O teste CORS de `Invoke-WebRequest` pelo PowerShell 5.1 lançou exceção,
que a versão anterior ocultava. **Não foi criado nem implantado Pages.**
Sem a exceção original não é possível atribuir a falha conclusivamente
a TLS, propagação pós-deploy, resposta HTTP ou configuração de Origin.

A correção substitui `Invoke-WebRequest` por uma checagem read-only com
`node scripts/check_staging_cors.mjs`. Ela mostra `httpStatus`,
`originReceived`, `workerApiVersion`, e falha sem deploy se a origem
não estiver autorizada. Inclui `-ReutilizarBuild`, que verifica o
pacote existente e os hashes SHA-256 dos arquivos estáticos espelhados,
sem repetir testes e reconstruir 141 MiB.

Para retomar a **primeira** publicação sem repetir Worker e build:

```powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
node scripts/check_staging_cors.mjs

# Execute SOMENTE se o comando anterior mostrar P17_CORS_PROBE_OK:
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Publicar-GPS-Homologacao.ps1" -CriarProjeto -Publicar -ReutilizarBuild
```

Caso o verificador mostre `P17_CORS_PROBE_NETWORK_FAILED`, `403` ou
`originReceived:null`, não republique cegamente. Encaminhe a saída,
pois indicará a causa ou etapa para investigar. Se o projeto já tiver
sido criado em tentativa posterior, retire `-CriarProjeto`.

## Critérios de homologação após publicar

1. GET em `/externo/gps-config.json` mostra `enabled:true`,
   `provider:"gtfs_rt"` e endpoint fixo Worker. O GitHub permanece com
   `static/gps-config.json` **enabled:false**.
2. Na URL real Pages, clicar em **Linhas → 5102** mostra as posições oficiais
   SUMOB no mapa, com timestamp GPS, sem prometer previsão de chegada.
3. Testar linha que não tenha veículos: não mostrar "0 ônibus circulando"
   quando a fonte estiver indisponível. Horários continuam disponíveis.
4. Confirmar acesso de Android em 360 e 390 px, tela inicial, trocas de aba,
   redução de chamadas em background, sem overflow horizontal.
5. Conferir DevTools > Network: o navegador consulta Worker com
   `source=GTFS_RT&routes=5102`; nenhum coordenada do usuário é enviada.
6. Monitorar Cloudflare Workers 24 h: P50/P90/P99 da **versão ativa**,
   exceções, CPU exceeded, requisições/dia e tempos de resposta.
   Evitar testes de carga agressivos contra fonte pública. Se o limite
   Free for atingido, manter GPS opcional e horários programados disponíveis.
7. Confirmar arquivo `scan/index.json`, viagens e horários em período
   válido do catálogo GTFS, antes de integração futura ao Hub.

Nunca fazer deploy automático do site de homologação para `ru-hoje`.
A passagem a produção exige autorização específica e validação separada.
