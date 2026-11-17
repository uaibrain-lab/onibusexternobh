# Integração única do Externo BH — P9 multimodal + P14 rastreamento/UX

**Estado em 17/11/2026: branch de desenvolvimento isolada, não publicada, sem alterações no Hub UFMG.**

## Fontes efetivamente consolidadas

- Base `feat/externo-p9-multimodal-gratuito-20261117` — commit `29077c7a8417adfb808a8d5f310c62e24bc8e7e6`: **Pontos, Linhas, Metrô, Rotas**, roteador GTFS no Web Worker, calendário, grafo caminhável OSM real, janelas indicativas do metrô, compilação estática compatível com Firebase Hosting Spark.
- Componentes reaproveitados de `feat/p14-hub-design-parity-embed` — commit `78c3ef471339e90a42605088eba4c3535bd8a8a6`: captura GPS conservadora, estimativa direcional, backend sem bloqueio, contadores, favoritos nomeados, painel mobile incremental, tema e identidade do Interno.
- A outra P9 `feat/externo-p9-caminhadas-metro-gratis-20261117` possui algoritmo alternativo de grafos/ferrovia. Ela foi analisada, mas **não mesclada automaticamente**: os dois grafos e roteadores não têm equivalência comprovada. O motor da P9 multimodal já possui grafo OSM real; uma duplicação custaria download/memória sem ganho demonstrado.

## Uma interface, dois modos gratuitos e honestos

| Recurso | Local Python (desenvolvimento) | Publicação estática Spark |
|---|---|---|
| Consulta/busca de pontos e linhas GTFS | Sim | Sim |
| Próximos horários **programados por sentido** | Sim | Sim, via `catalog/arrivals/<hash>.json.gz` |
| GPS e ETA conservador por veículo | Sim, quando PBH responder | **Não**. Mostra claramente ausência de GPS |
| Metrô (estações, linhas e informações habituais) | Sim | Sim, sem trens fictícios |
| Planejador GTFS de partida/chegada | Sim, implementação Python P9 | Sim, Web Worker |
| Caminhada por rede OSM | Consulta via motor disponível | Arquivo estático do grafo quando presente |
| PWA / favoritos locais | Página local (PWA só em escopo estático) | PWA com cache limitado |
| Infraestrutura de hospedagem paga | Não | Não |

**Não afirmar que o preview Spark oferece ônibus GPS ao vivo.** Para isso ainda será necessária fonte oficial acessível e adaptador de leitura gratuito, com teste real de CORS/quotas e atribuição segura de veículos; o PHP/Python do modo local não executa no Hosting estático.

## Chegadas programadas pequenas para celular

`scripts/build_static_arrivals.py` lê o próprio `catalog/timetable.json.gz` GTFS e produz 256 arquivos compactados distribuídos por hash de stop_id, com `calendar.json` e `index.json`. O navegador carrega apenas o bucket do ponto consultado.

O ensaio com o catálogo oficial da versão 202611161919 resultou em:
- 9.828 paradas com registros de horários (versus 9.925 paradas geográficas);
- 256 arquivos comprimidos, 18,26 MB **no total**, média ~71 KB por arquivo e maior arquivo ~207 KB;
- construção em ~6,5 s no ambiente de teste;
- ida/volta e destino alternativo da mesma linha permanecem separados;
- `stop_times` com mais de 24 horas e calendário semanal/exceções são tratados no navegador;
- data posterior a `feedEndDate` bloqueia o ETA, em vez de prolongar horários inválidos.

`scripts/build_static_site.py` gera esses arquivos dentro de `dist/externo/catalog/arrivals` sem armazenar o timetable monolítico no pacote público.

**Atenção a versões:** o empacotador rejeita base divergente em `validThrough`, quantidade de paradas ou viagens entre catálogo principal e índice de rotas. Esse bloqueio detecta inconsistências estruturais; versões diferentes com mesmas contagens ainda exigem a futura comparação por SHA do GTFS. Uma renovação oficial só pode ser publicada após regenerar e validar **todas** as bases dependentes do mesmo ZIP.

## Ergonomia mobile e contexto do passageiro

- Quatro seções sem alterar o menu raiz do Hub.
- Mapa agrupa pontos em zoom distante; toque em grupo aproxima.
- Linha escolhida na busca abre o padrão com mais viagens; seletor de **Sentido e percurso** permite trocar destinos e variantes.
- Linha aberta a partir de parada prefere somente variantes que atendam àquela parada e destino. O GPS nunca é prova de variante sem correspondência geométrica confiável.
- Parada centralizada na área livre do mapa, com cartão de chegadas que atualiza sem perder foco/rolagem.
- Favoritos locais nomeados, prévia de chegadas, links de ponto e botões legíveis de 44 px.
- PWA sob `/externo/`, sem interceptar `/` nem o SW do Hub; no futuro o agente de integração decidirá qual SW prevalece no Hosting compartilhado.
- Tema claro/escuro com possibilidade de herança same-origin e atributo `data-app-mode="free-static"`.

## Como homologar sem deploy

### Preview totalmente estático

```powershell
py -3 scripts/build_static_site.py
py -3 -m http.server 8765 --directory dist
```

Abrir `http://127.0.0.1:8765/externo/`. Testar Pontos, Linhas, Metrô e Rotas; horários são **de tabela**, sem GPS.

### Servidor local com GPS opcional

```powershell
py -3 server.py --port 8765
```

Abrir `http://127.0.0.1:8765/externo/`. As posições e ETAs por GPS só aparecem se a fonte PBH fornecer dados utilizáveis.

### Testes

```powershell
py -3 -m unittest discover -s tests -v
node --check static/app.js
node --check static/static-bus.js
node --check static/static-arrivals.js
node --check static/route-worker.js
node --test tests/test_unified_ui.cjs
```

Workflow `.github/workflows/integracao.yml` realiza também build, assets, HTTP smoke e outros testes, mas **as execuções mais recentes da plataforma GitHub Actions não iniciaram etapas de teste**. Não declarar CI aprovada. Testes isolados de sintaxe JS e simulações de chegada/sentido foram feitos, porém não equivalem a uma homologação em Android físico.

## Pendências obrigatórias para considerar pronto para produção

1. **CI completa verde** (atualmente jobs GitHub falhando antes de iniciar passos); validar Python, JS, HTTP e preview no mesmo commit.
2. QA real Android barato 350–390px, cache, memória, rede móvel fraca, mapa/metro/roteamento/rota reversa, tempo de resposta e acessibilidade.
3. Teste de 20+ percursos em campo com coordenadas, variantes GTFS, sentido, passagem real e caminhadas seguras; o planejador continua com respostas `partial` quando há poda.
4. Operação GPS gratuita pública **validada** — sem isso a versão estática mantém horários programados e não promete telemetria ao vivo.
5. Renovação do GTFS atômica (timetable, mapa, rotas, caminhadas e manifestos) pelo mesmo checksum e política de aprovação/rollback.
6. Cotas Spark + cache: monitorar transferência por pesquisa e não baixar 110 MiB de blocos horários de uma vez. Nem Blaze, nem VPS, nem API comercial obrigatória.
7. Só após homologação: integrar com o repositório do Hub UFMG (fora deste escopo).

**NENHUMA alteração no repositório `uaibrain-lab/ru-hoje`, no Firebase, em Worker publicado ou na branch `main`.**
