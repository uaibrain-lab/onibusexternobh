# P28 — Auditoria gratuita de topologia das baldeações

**Data:** 18/11/2026. **Escopo:** somente repositório \`uaibrain-lab/onibusexternobh\`, branch \`feat/gps-worker-free-homologacao-p15-20261117\`. **Não houve deploy.**

## Contexto e descoberta

A comparação de roteiros com Google/Moovit não pode ser resolvida simplesmente aumentando raio e número de vizinhos. A combinação **9106 + 5106** pode usar paradas de MESMO \`stop_id\`, enquanto **9209 + 51** depende de conectores a pé entre pontos distintos. O Google Maps pode fornecer serviços metropolitanos ausentes no GTFS municipal. A P27 já classificou rejeições de caminhada com a rede OSM; a P28 agrega evidência de topologia do GTFS.

Auditoria independente no ZIP original do GTFS municipal do aplicativo (SHA-256 documentado em P27):
- \`9106 + 5106\`: 22 IDs de pontos compartilhados.
- \`9209 + 51\`: nenhum ID compartilhado.
- \`9209 + 67\`: 4 IDs compartilhados.

**Esses números não equivalem a conexões programadas viáveis.** Mesma parada não garante mesmo sentido, mesmo dia de serviço ou baldeação temporalmente possível. Paradas diferentes dentro de 450 m também não garantem rota pedestre pela rede OSM nem acesso a plataformas/estações.

## Implementado nesta rodada

- \`scripts/audit_transfer_topology.py\`: leitura local de \`catalog/scan/stops.json.gz\` e \`catalog/routing-stop-routes.json\`. Emite apenas contagens e distâncias agregadas. Usa grade espacial para evitar comparar todos os pontos, limita raio a 1–1000 m, no máximo 20 combinações, e opera sem rede, backend, API ou armazenamento.
- \`tests/test_audit_transfer_topology.py\`: testes para paradas compartilhadas, pares distintos, limites e códigos de linhas; validado sinteticamente no ambiente da IA.
- \`.github/workflows/integracao.yml\`: inclui auditoria no CI com os **dados reais presentes no repositório** e captura o resumo da topologia, sem baixar nova versão de GTFS. Não disponibiliza qualquer coordenada individual no relatório.

### Comando local

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
py -m unittest discover -s tests -p "test_audit_transfer_topology.py" -v
py scripts/audit_transfer_topology.py --pairs=9106+5106,9209+51,9209+67 --radius=450
~~~

Saída: \`sharedStopIds\` e \`distinctStopPairsWithinRadius\`, **não** ETA. Se os resultados de topologia diferirem do ZIP original, investigar versão/catálogo antes de concluir erro de roteamento. A auditoria **não verifica sentido nem horários** e não altera o motor em produção.

## Próximas ações prioritárias (não presumir concluídas)

1. Obter o diagnóstico real das linhas \`9106+5106\`, \`9209+51\` e \`9209+67\` no mesmo par exato de coordenadas/data/hora: separar \`streetDisconnected\`, margem e direção.
2. Melhorar o roteador de conexões apenas quando isso preservar **ruas reais, horários e folga de embarque**; jamais inventar travessias, movimento ou ETA. Para \`9106+5106\`, investigar por que conexões no mesmo ponto, se houver na data/horário, não sobrevivem ao scan/validação.
3. GTFS-Realtime SUMOB: validar serviço, trip_id, start_date/start_time, original stop_sequence e ausência de timestamp individual antes de qualquer estimativa visível.
4. Linhas 411C/511C: obter dados oficiais completos e georreferenciamento DER/MG; nunca inventar viagens/horários.
5. QA mobile (360px e 390px), CPU/memória e equivalência gratuita de hospedagem antes de deploy.

**Handoff obrigatório:** a próxima IA deve ler o estado de branch, commits mais recentes e workflows; anotar nesta seção os resultados reais da auditoria e do CI, atualizar pendências, e verificar arquivo SHA antes de qualquer edição. Não tocar em Hub/ru-hoje, não dar merge nem realizar deploy.
