# P9 — Caminhadas OSM reais, metrô por faixas estimadas e quatro abas gratuitas

Branch: feat/externo-p9-caminhadas-metro-gratis-20261117
Base: feat/externo-p8-precisao-atualizacao-gratuita-20261117
Estado: candidata à homologação, sem deploy em produção.

## 1. Caminhadas em vias reais do OpenStreetMap

- Fonte ODbL: https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf (© OpenStreetMap contributors).
- Extração do perímetro BH/Contagem pela ferramenta osmium; processamento gratuito no GitHub Actions e publicação somente na branch P9.
- Grafo estático em catalog/pedestrian: 547.515 nós, 1.197.201 arestas direcionadas, 3.117 tiles comprimidos somando 12.288.531 bytes (aproximadamente 11,72 MiB).
- Buscador A* de ruas no Web Worker do navegador, com carregamento sob demanda, restrições básicas de circulação a pé e prevenção de cruzamentos fantasmas sem nó OSM em comum.
- Percursos em static/pedestrian.js, renderizados no mapa pelo app.js. Conexões sem caminho no grafo são rejeitadas; acessos a nós distantes são identificados como incertos.
- Cache local limitado para não pré-baixar toda a rede.

**Limitação:** um caminho mapeado não comprova segurança da travessia, acessibilidade, qualidade da calçada nem funcionamento de entradas e portões. O encaixe entre o local escolhido e a via OSM pode ser aproximado; essa incerteza aparece na UI.

## 2. Metrô temporal, mas sem horários inventados

- Catálogo de linhas, horários de funcionamento, intervalos divulgados e exceções operacionais.
- Referências históricas de duração ferroviária transformadas em faixas estimadas, com incerteza declarada, nunca horários individuais fictícios.
- A operação é avaliada no horário aproximado de embarque após a caminhada; Linha 2 sem frequência validada não recebe espera máxima falsa.
- Possibilidades condicionais ônibus+metrô só são apresentadas quando há viagem GTFS identificada e conexão plausível. Mantidas separadas da classificação de ônibus programados.
- Referências: https://www.metrobh.com.br/va-de-metro/ ; https://www.metrobh.com.br/o-primeiro-ano-de-concessao-do-sistema/ ; https://www.hojeemdia.com.br/minas/video-conheca-o-trajeto-das-duas-novas-estac-es-da-linha-2-do-metro-de-bh-1.1123686 .

**Limitação:** sem grade oficial verificável de partidas do metrô, NÃO existe previsão temporal precisa nem garantia de baldeação ferroviária em uma viagem real.

## 3. Melhorias na busca

- Modo Mais rápido com Connection Scan orientado por tempo e estado por parada/número de embarques, sem poda arbitrária de rótulos Pareto no cálculo programado.
- Critérios de Menos caminhada e Menos baldeações ainda usam busca multicritério com limites explícitos.
- Busca limitada a até cinco horas e três embarques. Se o verificador OSM conferir apenas um subconjunto dos candidatos, a resposta passa a indicar parcial, mesmo quando o scan GTFS foi completo.
- Benchmark GitHub UFMG–Centro: partida 4,13 MB baixados, 6 opções em cerca de 4,6 s antes do custo de rede; chegada 3,48 MB adicionais, 6 opções em cerca de 4,8 s. Tempos variam por execução/aparelho.

## 4. Migração da hospedagem estática

- As quatro abas Pontos, Linhas, Metrô e Rotas estão no pacote estático sem servidor Python obrigatório.
- static/catalog-api.js usa arquivos locais routes.json, patterns.json, shapes.json, stops.json e routing-stop-routes.json para os dados GTFS de linhas e pontos.
- GPS ao vivo não foi integrado à hospedagem estática, pois não existe feed/caminho validado e seguro nesta fase. A interface informa indisponibilidade, sem inventar veículos.
- O detalhe de ponto não confunde falta de consulta de horários por parada com ausência de ônibus programado; para itinerários o usuário usa a aba Rotas.
- O empacotador scripts/build_static_site.py produz preview para Firebase Hosting Spark, sem ativar Blaze/Cloud Functions.

## 5. Testes realizados

- Grafo OSM real gerado e publicado na branch via .github/workflows/build-pedestrian.yml.
- Suites Python e JavaScript no workflow test-p9.yml, incluindo calendário, sentidos, restrições GTFS, regras de acesso pedestre e estimativas do metrô.
- Chromium Playwright com Android emulado 390×844 e desktop 1365×840 passou, verificando as quatro abas, navegação, seis itinerários e geometrias reais de caminhadas.
- **Não foram realizados testes em celular físico ou confrontação presencial com ônibus/trens em circulação.** Não afirmar que isso está homologado.

## 6. Checklist de homologação física pendente

- Testar trajetos em UFMG, Centro, Pampulha, Barreiro e Venda Nova, nos dias úteis, fins de semana, feriados e após meia-noite.
- Conferir pontos reais de acesso, travessias, escadas, portões fechados, acessibilidade e correspondência dos horários programados com a operação.
- Validar em Android físico modesto, iOS Safari, rede 4G limitada, mudanças de conexão e uso offline após cache.
- Monitorar quotas gratuitas, comportamento de erros e envelhecimento dos horários GTFS.

## 7. Custos e limites

- GitHub Actions gratuito para preparar dados OSM/GTFS e Firebase Hosting Spark para arquivos públicos; sujeito a cotas de tráfego/armazenamento e às condições vigentes.
- Nenhum serviço de roteamento cobrado por consulta, VPS, Cloud Functions ou API comercial obrigatório.
- Não há publicação na produção nem alteração do Hub UFMG. A agenda de renovação GTFS preparada na P8 precisa entrar na branch padrão para ficar ativa; ainda não é um deploy Firebase.
- GTFS oficial publicado válido até 31/12/2026; não extrapolar além da validade.

Conclusão: P9 é uma candidata técnica importante, porém não garante precisão universal, previsão de GPS em tempo real nem partida de trem exata.
