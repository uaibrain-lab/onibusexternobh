# P14 — Prontidão visual para o Hub UFMG (somente repositório Externo)

**Referência de leitura:** [ru-hoje](https://github.com/uaibrain-lab/ru-hoje), branch `main`, commit `38f8933fb830d760b24ecdc57092df034c5a1b76`, em 17/11/2026.

**Escopo de escrita:** apenas `uaibrain-lab/onibusexternobh`, branch `feat/p14-hub-design-parity-embed`. Nenhum arquivo foi alterado em `ru-hoje`. Não foi realizada a integração.

## Como o Hub realmente organiza a interface

Arquivos consultados, exclusivamente para leitura:

- `ru-hoje/public/index.html`: menu principal **Cardápio / Interno / Festas / Sobre**, topbar e iframe `/interno` com `allow="geolocation"`; NÃO possui atualmente a aba Externo.
- `ru-hoje/public/assets/styles.css`: identidade externa do Hub em roxo (`--purple:#6d4cd1`) e cardápios em superfícies suaves. A navegação mobile fica na borda inferior. O iframe interno recebe dimensões próprias e borda arredondada.
- `ru-hoje/public/interno/index.html`: a aba de **mapa** usa **outra paleta, neutra**, não a paleta roxa do cardápio: `--bg:#fff`, `--bg2:#f2f4f7`, `--ink:#101828`, `--mut:#667085`, `--line:#e4e7ec`. No escuro: `--bg:#14181f`, `--bg2:#1e242d`, `--ink:#f5f7fa`, `--mut:#9aa6b6`, `--line:#2b333e`. O mapa ocupa a área, a consulta fica em painel inferior no celular e lateral esquerda no desktop, com **Pontos/Linhas**, tela de detalhe que oculta o cabeçalho e controle de zoom.
- `ru-hoje/public/assets/app.js`: o tema do Hub acompanha `prefers-color-scheme` e aplica `data-theme` no documento pai. O código de produção atualmente não envia mensagem de tema para o iframe.
- `ru-hoje/public/service-worker.js`: SW do Hub atualiza os arquivos próprios em estratégia network-first. Antes da integração será necessário garantir que não devolva `/index.html` do Hub para a navegação offline de `/externo/`.

## Entregue neste projeto

1. **Paridade, não duplicação:** `static/hub-parity.css` reproduz a hierarquia e ergonomia do Interno. Nenhum stylesheet, menu principal ou script do `ru-hoje` é importado.
2. **Tela mobile:** detalhe da parada passa a ocultar o cabeçalho da busca quando expandido, com botões de 44 px, tempos de chegada legíveis, painel de 55dvh ou expansão total, foco no ponto e proteção da área visível do mapa. O mapa continua ocupando a tela disponível no iframe.
3. **Tema:** antes da renderização, `static/index.html` define `data-theme` pela preferência do sistema e, quando possível, herda `data-theme` do documento pai na mesma origem. `static/app.js` atualiza em mudanças da preferência e aceita **opcionalmente** `postMessage({type:'hub-theme',theme:'dark'|'light'})` somente do parent e com mesma origem. O Hub existente não precisa enviar essa mensagem.
4. **Sem mapa-base:** o canvas mantém pontos, agrupamentos e trajetos. Após falhas de tiles, mostra aviso não bloqueante; volta ao normal após carregamentos bem-sucedidos. O tema escuro também muda as cores do fundo sem tiles.
5. **Rotas e arquivos:** `/externo` redireciona com HTTP 308 para `/externo/`, preservando `./app.js`, `./style.css`, `./hub-parity.css`, `./sw.js`. `/externo/api/*` mantém o comportamento de API já implementado. O protótipo tem `X-Frame-Options: SAMEORIGIN` e CSP `frame-ancestors 'self'`.
6. **PWA:** SW próprio usa escopo relativo `./` quando em `/externo/`, agora mantém também `hub-parity.css` no shell offline; não guarda dados GPS, ETAs nem tiles.

## Contrato para integração futura — **NÃO EXECUTAR nesta fase**

O agente responsável pela integração final poderá montar um iframe dentro de uma nova seção do Hub:

```html
<iframe
  title="Externo — pontos, linhas e chegadas de ônibus em BH"
  src="/externo/"
  loading="lazy"
  allow="geolocation"></iframe>
```

**Precondições:** mesmo domínio (ou políticas de frame revisadas); disponibilizar recursos estáticos em `/externo/` e API em `/externo/api/*`; backend de coleta GPS com cache compartilhado (Firebase Hosting isoladamente NÃO executa Python); respeitar cotas e políticas de fonte e tiles; tratar a rota Externo no SW do Hub e no roteamento Hosting; publicar depois de homologação dos agentes de metrô/roteamento.

**Sem acesso à integração final:** este PR não acrescenta tab ao Hub, não integra metrô, não altera seu SW, não altera backend de produção e não realiza deploy.

## Verificações

```bash
python -m unittest discover -s tests -v
node --check static/app.js
node --check static/sw.js
node --test tests/*.cjs
```

O teste HTTP `tests/test_p14_iframe_http.py` inicia o servidor local sem fontes externas e valida canonização, assets e API sob prefixo. `tests/test_p14_ui.cjs` testa por inspeção o contrato de CSS, tema, iframe, tela de detalhe e fallback de tiles. **Homologação visual em Android real** e validação em ambiente staging do Hub ainda são necessárias após a integração.

## Limite explícito

`ru-hoje` permanece **somente referência de leitura**. Nenhum arquivo, branch, workflow, SW, configuração Firebase ou produção desse repositório pode ser alterado por esta fase.
