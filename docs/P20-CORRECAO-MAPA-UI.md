# P20 — Correção do mapa inicial e sobreposição da interface

**17/11/2026. Escopo:** uaibrain-lab/onibusexternobh, branch
feat/gps-worker-free-homologacao-p15-20261117, PR #19.

## Motivo

O usuário relatou, no site público de homologação Pages:
- No PC e no celular o mapa fica preso em "Carregando mapa";
- o layout fica desconfigurado e elementos ficam sobrepostos.

A auditoria P18_PUBLIC_AUDIT_OK validou HTTP/catálogos/GPS, mas NÃO testava
o primeiro render do canvas nem a geometria dos controles.

## Causa comprovada por inspeção do fonte

static/app.js chama getTile() a partir de drawTiles() no primeiro RAF.
getTile() consultava TILE_CACHE_LIMIT sem qualquer declaração no código.
Isso lança ReferenceError e interrompe draw() ANTES de atualizar a
mensagem inicial "Carregando mapa". O erro não depende de CORS ou GPS.

Problema de layout independente: em desktop, o painel lateral de 346px
tentava encaixar identidade + quatro abas de largura mínima 64px numa
única linha. As regras legadas tinham largura mínima conflitante no
mobile e havia sobreposição possível dos avisos do mapa e zoom.

## Alterações na branch (sem deploy automático)

- static/app.js:
  * declarou TILE_CACHE_LIMIT=120 e conservou remoção FIFO de tiles;
  * drawSoon expõe data-render-status=ready após desenho concluído;
    em caso de falha, mostra aviso, nunca fica em "Carregando mapa";
  * veículos SUMOB sem histórico de movimento não recebem cor/alerta
    de "imóvel" apenas porque positionUnchangedSinceAt=null.
- static/hub-parity.css: desktop em duas linhas (identidade e tabs
  4 colunas), mobile com quatro tabs proporcionais e 44px de altura,
  responsividade de campos/cards, zonas separadas para zoom/avisos,
  sem scroll horizontal global.
- scripts/build_static_site.py: apenas no --gps-staging acrescenta
  versão de cache-busting P20 a JS e CSS e no-cache nos arquivos de
  interface. O build normal permanece intocado.
- scripts/Publicar-GPS-Homologacao.ps1: bloqueia publicação se o teste
  do mapa P20 falhar. Não reutilizar dist antigo nesta publicação.
- tests/test_p20_map_layout.cjs: exercita as funções reais do canvas
  sem rede e confirma cache limitado.
- tests/browser-p20-map-ui.spec.cjs: nos 3 perfis do Playwright testa
  início do mapa inclusive com tiles OSM bloqueados, tabs de 44px,
  erros JavaScript, retângulos sem interseções e viewport sem overflow.

## Testes já executados pelo assistente

- Avaliação isolada de getTile()/drawTiles() com stub de canvas:
  35 tiles gerados, múltiplas operações de pintura executadas,
  sem ReferenceError; 245 acessos adicionais mantiveram 127 entradas
  (limite operacional <= 120 + margem de 16).
- Sintaxe JS de app.js e browser-p20: OK.
- Verificação de seletores CSS exigidos pelo teste unitário: OK.

**Ainda NÃO executados:** suíte Node do repositório no Windows, build
completo, Playwright em Chrome real e revisão visual do novo deploy.
**Ainda não publicado:** P20 no Cloudflare Pages. O site público pode
continuar apresentando o problema até o próximo deploy.

## Como publicar a correção APENAS no Pages de homologação

PowerShell 5.1 (pasta já clonada do Externo):

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117

node --test tests/test_p20_map_layout.cjs

powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Publicar-GPS-Homologacao.ps1" -Publicar
~~~

NÃO use -ReutilizarBuild: um pacote P17 antigo não contém as correções.
NÃO use -CriarProjeto: Pages já foi criado e está online.
NÃO use -AtualizarWorker: a alteração P20 é somente do front-end.
O script roda as validações e gera dist do zero; o único deploy é
wrangler pages deploy dist no projeto externo-bh-hml-uaibrain.

Depois do deploy, abrir
https://externo-bh-hml-uaibrain.pages.dev/externo/
e recarregar com Ctrl+Shift+R (no PC); em PWA já instalado, fechar
e reabrir caso a versão antiga ainda esteja presente.

## Teste opcional E2E em browser local

É necessário Playwright + Chromium instalados conforme
.github/workflows/p9-browser.yml. No Windows, após construir dist:

~~~powershell
python -m http.server 8765 --directory dist
~~~

Em outro PowerShell:

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
npx.cmd playwright test tests/browser-p20-map-ui.spec.cjs --config=tests/playwright.config.cjs
~~~

Os testes emulam desktop 1366x768, Android 390 e Android 360,
forçam erro nos tiles OSM e exigem que o canvas seja desenhado;
não consultam o Worker GPS e não alteram produção.

## Homologação pendente

1. Confirmar no PC e Android que a mensagem de carregamento termina,
   mesmo se tiles OSM estiverem temporariamente indisponíveis.
2. Conferir que o mapa visual mostra blocos OSM; se só aparecer
   fundo quadriculado e aviso de mapa-base, diagnosticar acesso
   ao tile.openstreetmap.org separadamente. Não é GPS/CORS SUMOB.
3. Quatro abas e botões sem sobreposição, inclusive com sheet aberto.
4. Buscar 5102 e ver ônibus reais e horário do fix, sem alegar ETA.
5. Nenhuma alteração no Hub ru-hoje, Firebase ou qualquer plano pago.
