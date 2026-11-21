# Análise sanitizada de HAR do Google Maps e comparação com Moovit

**Data das capturas:** 17/11/2026, horário local de Belo Horizonte.
**Fonte:** \`www.google.com.har\` fornecido pelo usuário, confrontado com a captura anterior \`moovitapp.com(1).har\`.
**Escopo:** análise técnica da navegação e do planejamento de ônibus, sem acessar endpoints privados com scripts e sem publicar conteúdo bruto.
**Situação:** documento analítico; nenhuma alteração do motor de roteamento ou deploy nesta etapa.

## 1. Principais requisições encontradas

O HAR do Google contém 419 solicitações, das quais:
- 382 ao host \`www.google.com\`;
- 198 \`GET /maps/vt/proto\`, relacionadas aos dados gráficos do mapa;
- 2 \`GET /maps/preview/directions\`, retornando HTTP 200;
- 1 \`GET /maps/preview/place\`, HTTP 200;
- 5 \`POST /maps/_/MapsWizUi/data/batchexecute\`, HTTP 200;
- outras solicitações de imagens, ícones, métricas e recursos auxiliares.

A chamada principal de direções retornou aproximadamente 258 KB de
JSON com prefixo de proteção contra inclusão cruzada, estruturado
como arrays aninhados por índices, com seis alternativas de transporte
público. O parâmetro \`pb\` da URL contém parâmetros empacotados
(privados, não documentados para consumo externo).

**Não é a Routes API pública:** não apareceram chamadas ao endpoint
oficial \`POST https://routes.googleapis.com/directions/v2:computeRoutes\`
na captura. Não confundir a API do site do Google Maps com um contrato
público/documentado para integração.

Também não apareceu uma solicitação direta identificável de Vehicle
Positions/GTFS-RT no browser. Isso NÃO prova que o serviço do Google não
incorporou dados reais no backend, apenas que o HAR não os expõe
separadamente. Os pesos do algoritmo de escolha não são públicos.

## 2. Rotas e composição de duração retornadas

Busca realizada aproximadamente às 22h26, em Belo Horizonte,
com origem na região da Sagrada Família e destino em uma estação MOVE
que inclui "Mineirão" no nome (não necessariamente o estádio).

| Ordem retornada pelo Google | Linhas | Partida | Chegada | Duração | Caminhada | Dentro de ônibus | Espera entre trechos |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | 9209 + 411C | 22:29:21 | 23:12:45 | 43:24 | 05:17 | 26:43 | 11:24 |
| 2 | 9209 + 51 | 22:29:21 | 23:18:56 | 49:35 | 08:41 | 28:16 | 12:38 |
| 3 | 9106 + 411C | 22:30:42 | 23:12:45 | 42:03 | 09:58 | 24:59 | 07:06 |
| 4 | 9106 + 5106 | 22:30:42 | 23:23:54 | 53:12 | 14:55 | 34:07 | 04:10 |
| 5 | 9209 + 67 | 22:29:30 | 23:30:40 | 61:10 | 14:38 | 38:34 | 07:58 |
| 6 | 9209 + 511C | 22:29:21 | 23:17:33 | 48:12 | 11:08 | 25:59 | 11:05 |

O tempo de espera foi calculado localmente como:
\`duração total - soma(duração das pernas a pé e nos ônibus)\`.
Ele inclui intervalos entre as etapas programadas do itinerário,
não uma previsão GPS. Os detalhes de horário foram obtidos da resposta,
não de um modelo matemático inventado.

**Achado interessante sobre o ranking:** a primeira resposta do Google
foi 9209+411C (43:24, 05:17 andando), antes de 9106+411C
(42:03, 09:58 andando), embora cheguem ambas exatamente às 23:12:45.
Isso é consistente com uma ordenação que considera mais do que duração
mínima, mas a captura não fornece os pesos exatos, nem permite afirmar
qual foi a razão interna de ordenação.

**Duração x tempo desde agora:** o retorno principal ocorreu em torno
de 22:26:26 e o primeiro roteiro começa 22:29:21. A chegada de
23:12:45 representa aproximadamente 46min19s a partir da consulta,
apesar dos 43min24s que aparecem como duração da viagem.
O Externo BH deve distinguir os conceitos.

## 3. Comparação das duas capturas: destino diferente!

Foi feita comparação geométrica local com as coordenadas presentes
nos HARs, sem registrá-las aqui:

- Distância entre origens escolhidas: **aproximadamente 167 metros**.
- Distância entre destinos escolhidos: **aproximadamente 4.151 metros**.

Logo, os tempos Moovit 39:51 (9209+9502+511C) e 42:47 (9209+411C)
NÃO podem ser diretamente usados como referência contra os tempos
Google 42–53min da captura; são deslocamentos diferentes.

Moovit e Maps têm locais com nome próximo ao Mineirão, mas o destino
Google foi uma estação MOVE diferente do destino selecionado no Moovit.
Isso provavelmente explica grande parte da divergência anterior.
Para comparação controlada, selecionar exatamente a MESMA latitude/
longitude de origem e destino e o MESMO horário/modalidade (departAt
ou arriveBy), além de calendário e atualizações ativas.

## 4. Endpoints internos, permissões e arquitetura sem custos

### Google Maps Web

- \`GET /maps/preview/directions\` é endpoint interno do Google Maps.
- O parâmetro \`pb\` e os cabeçalhos específicos do navegador são
  mecanismos internos, não uma API contratual documentada ou estável.
- Na captura, a resposta não forneceu
  \`Access-Control-Allow-Origin\`; acesso entre origens do Externo BH
  por \`fetch\` não está demonstrado e pode ser bloqueado.
- Mesmo que uma requisição reproduzida devolvesse HTTP 200, isso não
  assegura permissão de integração, estabilidade, disponibilidade ou
  autorização para redistribuição de dados.

### API oficial documentada

O Google Routes API documenta o endpoint
\`POST https://routes.googleapis.com/directions/v2:computeRoutes\`,
com \`travelMode: "TRANSIT"\`, hora de partida ou chegada, alternativas
e preferências de caminhada/baldeações.
A utilização regular exige **chave/OAuth e faturamento habilitado**
no projeto. Existem franquias sem custo por categoria, mas não acesso
gratuito irrestrito, e o preço varia conforme a SKU utilizada.
A arquitetura do Externo BH não pode exigir conta paga, cartão,
Cloud Billing ou excedentes potencialmente cobrados.

Referências oficiais verificadas:
- https://developers.google.com/maps/documentation/routes/transit-route
- https://developers.google.com/maps/documentation/routes/usage-and-billing
- https://developers.google.com/maps/billing-and-pricing/pricing

## 5. Melhorias concretas e gratuitas que a observação sugere

1. Exibir dois tempos: \`duração do roteiro\` e \`tempo desde agora até chegar\`,
   quando a partida sugerida é futura. Especificar dia, horário e fuso.
2. Preservar preferência **Mais rápido** (chegada mais cedo) e permitir
   **Equilibrada** / **Menos caminhada** / **Menos baldeações**.
   A ordenação deve considerar experiência, não só duração em minutos.
3. Comparar detalhes das pernas: walking+onboard+waiting; eliminar
   trajetos que tenham baldeações fisicamente impossíveis.
4. Agrupar alternativas de linhas apenas quando servem à mesma etapa
   com paradas, sentidos, horários compatíveis.
5. Validar caminhos de acesso ao ponto, sentidos MOVE, transferências,
   caminhos entre plataformas e intervalos mínimos.
6. Criar banco de benchmarks apenas com pares de coordenadas
   consentidos ou sintéticos, sem guardar HAR, cookies, token, sessão,
   local privado ou identificadores.
7. Não substituir GTFS/GTFS-RT público por endpoint proprietário
   do Google. Usar a captura apenas para auditoria de qualidade.
8. Validar relógios: data da consulta, primeiro embarque,
   espera pré-partida, saída efetiva e chegada.

## 6. Privacidade e status de desenvolvimento

- **O HAR bruto NÃO foi enviado ao GitHub**.
- Não incluir endereços residenciais, coordenadas exatas do usuário,
  cookies, tokens, links \`pb\` integrais ou cabeçalhos de validação.
- Nenhum script faz consultas repetidas aos endpoints internos do Google.
- Nenhum arquivo do Externo BH, Worker GPS, Hub ou Firebase foi alterado
  por este relatório; não houve deploy.
- Próxima implementação deve verificar estado atual e executar testes
  Node/Python/Playwright antes de publicação, com foco no modo mobile.
