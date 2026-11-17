# Consolidação do Externo — revisão final isolada

**Repositório permitido:** `uaibrain-lab/onibusexternobh`. **Nenhum commit no `ru-hoje`**. Sem merge na `main`, sem deploy, sem Blaze/VPS/API paga.

## Linha de base integrada
Esta branch parte de `feat/integracao-unica-pontos-gps-metro-rotas-20261117`, que já reuniu:
- Pontos e linhas da PBH, direção, variantes, favoritos e próximos horários por ponto;
- Metrô BH e indicação honesta de intervalos/horários habituais;
- Planejador em Web Worker por data/hora de partida ou chegada, horários GTFS, caminhada OSM quando disponível e alternativas;
- Mapa, agrupamento, interface mobile P14, PWA e tema;
- GPS/ETA conservador **somente no servidor local Python**, sob disponibilidade da fonte PBH.

## Alterações desta revisão
1. **Busca estática por grade espacial:** `static/static-bus.js` indexa geograficamente paradas e reutiliza o índice nas consultas ao mapa e às proximidades. Antes, percorriam-se as ~9.925 paradas em cada movimento; agora a consulta examina apenas células do retângulo, com fallback para áreas amplas. A finalidade é reduzir CPU e bateria em Android.
2. **Índice reverso de variantes por parada:** o painel não precisa percorrer todos os padrões GTFS a cada ponto aberto. Preserva destinos e sentidos separados.
3. **Controle de versão de GTFS no navegador:** `scripts/build_static_site.py` agora publica `catalog/manifest.json`. O adapter de pontos usa `gtfsVersion` como parâmetro de versão em todas as consultas estáticas, sem confiar apenas no cache antigo.
4. **Chegadas consistentes:** `static/static-arrivals.js` compara a versão do índice de horários com a versão oficial carregada pelo adapter. Caso divergentes, os horários são recusados em vez de misturar versões. O calendário também usa URL versionada.
5. **Testes de regressão:** adicionados testes de grade espacial, pontos, variantes, presença de GPS e compatibilidade de versão; mocks antigos atualizados; pipeline integrado passa a verificar `catalog/manifest.json` no pacote.

## Como executar localmente
```bash
python -m unittest discover -s tests -v
node --check static/app.js
node --check static/static-bus.js
node --check static/static-arrivals.js
node --check static/route-worker.js
node --test tests/test_*.cjs
python scripts/build_static_site.py
python -m http.server 8765 --directory dist
```
Abrir `http://localhost:8765/externo/`.

## Limitações reais
- O Firebase Hosting Spark executa apenas arquivos estáticos: **não executa o servidor Python de GPS/ETA**. A versão estática mostra **horários programados**, nunca GPS fictício. Uma solução pública de GPS só deve ser ativada após validação real de fonte, CORS, limites e serviço gratuito opcional.
- O planejamento pode produzir resultados marcados como parciais; isso não garante a melhor opção global. Metrô tem faixas informativas, não partidas individuais comprovadas.
- Índice de rotas binário ~110 MiB no catálogo (não descarregado integralmente de uma vez). É obrigatório medir tráfego, cache e memória em Android real antes de publicar em escala.
- A validade oficial atual é 31/12/2026. GTFS deve ser renovado e versionado atomicamente com rotas, caminhadas e horários.
- **GitHub Actions:** na branch de integração de origem foram observadas falhas de jobs sem qualquer etapa executada (`steps=null`). O log hospedado retornou 404; não está provada a causa, e nenhuma CI deve ser anunciada como verde até executar os testes completos. A branch de revisão necessita verificação pelo runner.
- Publicação no Hub permanece fora do escopo; `ru-hoje` está intacto.

## Critério de conclusão
Interfaces Pontos/Linhas/Metrô/Rotas funcionam numa só aplicação e num único build estático, preservando modo local com GPS. Validar em navegador real, Android intermediário e pipeline verde antes de tratar como pronta para produção.
