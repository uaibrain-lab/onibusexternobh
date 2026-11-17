# Contrato visual e integração futura — Hub UFMG / Externo

## Referência canônica

- Hub UFMG: https://github.com/uaibrain-lab/ru-hoje
- Referência visual e comportamental: `public/interno/index.html` (aba **Interno**).
- Página-base do Hub: `public/index.html` e `public/assets/styles.css`.
- Projeto independente: https://github.com/uaibrain-lab/onibusexternobh

## Contrato UX (adotado na P2)

1. O mapa ocupa a área inteira da aba e tem prioridade visual.
2. Painel sobre o mapa: lateral esquerda (desktop >= 760px); inferior com alça, vista compacta e expansão (mobile).
3. Alternância `Pontos` / `Linhas` no cabeçalho, com alvos de toque grandes.
4. Selecionar ponto na lista centraliza o mapa e expande o painel; tocar no marcador do ponto abre a aba Pontos.
5. Pesquisar pontos de toda a cidade, sem carregar 9.925 cartões simultaneamente; a API estática traz até 50 por busca.
6. Pesquisar/selecionar linha; mostrar veículos e variantes GTFS; deixar explícito que uma variante selecionada NÃO comprova a rota percorrida por cada ônibus.
7. A cor e a aparência seguem as variáveis visuais do Interno (`--bg`, `--bg2`, `--ink`, `--mut`, `--line`, `--sh`) e preferência claro/escuro; permitir sincronizar tema por evento `hub-theme` da mesma origem.
8. Não inserir outro menu principal, identidade comercial ou cabeçalho próprio dentro do iframe.
9. Cada veículo informa separadamente horário GPS e tempo desde a última mudança de coordenada. Resposta HTTP recente não reseta a hora do GPS.
10. Interface mantém funcionalidade básica com mapa-base indisponível, mas nunca sugere que posição velha é atual.

## Contrato de rotas

- Modo local: `http://127.0.0.1:8765/`.
- Modo para homologar integração: `http://127.0.0.1:8765/externo/`.
- Assets relativos: `./style.css`, `./app.js`.
- API local: `/api/routes`, `/api/stops`, `/api/route`, `/api/fleet`, `/api/status`.
- API alternativa sob prefixo: `/externo/api/*`, permitindo o futuro roteamento do Hub.
- Cabeçalhos do protótipo permitem iframe **somente na mesma origem** (`SAMEORIGIN`, `frame-ancestors 'self'`).

## Separação arquitetura

- Este repositório contém o catálogo GTFS e o motor GPS; o Hub contém a navegação geral e aba Interno.
- Por enquanto NÃO copiar `public/interno/index.html` nem alterar a produção `hubufmg.web.app`.
- A integração posterior deverá adicionar a aba Externo ao Hub, apontando para `/externo/` em iframe do mesmo domínio, após preparar backend/proxy e validar CORS, cache, SLA e licenças.
- Firebase Hosting estático **não hospeda** o backend Python. É indispensável resolver infraestrutura gratuita de coleta e cache antes de produção.
- Não publicar milhares de requisições por visitante na fonte PBH; servidor faz coleta compartilhada, com limite mínimo de 35 s.

## Verificações antes da integração final

- Conferir tema claro/escuro após mudança de tema no Hub; foco e acessibilidade no painel.
- Conferir celular pequeno, tablet, desktop, iframe, safe-area e rolagem sem conflito entre painel e mapa.
- Verificar sincronização de favoritos e busca de paradas conforme decisões de produto posteriores.
- Criar staging no Hub, sem editar o Interno ou substituir outros arquivos existentes em produção.
