# P28 — Auditoria gratuita de baldeações na mesma parada

**Repositório exclusivo:** uaibrain-lab/onibusexternobh
**Branch:** feat/gps-worker-free-homologacao-p15-20261117
**Status:** testes e código na branch; sem deploy. Não alterar Hub UFMG ou ru-hoje.

## Evidências que motivaram esta fase

O GTFS original do aplicativo mostrou que as linhas:
- 9106 + 5106 têm 22 stop_id comuns;
- 9209 + 67 têm 4 stop_id comuns;
- 9209 + 51 têm 0 stop_id comuns.

Isso não prova que os horários ou sentidos permitem baldeação.
O verificador OSM rejeitou sete candidatos 9106+5106 na busca de
referência, mas é necessário separar a restrição temporal da caminhada
e não inventar conexões sobre barreiras físicas.

## Implementado — somente leitura

- scripts/audit_same_stop_transfers.py pesquisa as linhas com data,
  hora, janela de até cinco horas, espera mínima e máxima.
- Lê APENAS os shards GTFS municipais usados pelo aplicativo, sem rede.
- Confere calendário, exceções, pickup_type, drop_off_type,
  embarque anterior, desembarque, embarque seguinte e dia de serviço.
- Compara horários programados em stop_id IDÊNTICO e trata corretamente
  horários GTFS 24h+ após meia-noite.
- Relata possibilidades programadas, até oito exemplos com stop_id
  público, sem expor trip_id, coordenadas ou tokens.
- tests/test_p28_same_stop_transfers.py cobre essa lógica com dados
  sintéticos, incluindo dia de serviço anterior e serviços cancelados.
- CI de integração executa automaticamente todos os test_*.py.
- Não altera o Connection Scan nem habilita ETA ao vivo.

## Comandos no Windows (sem deploy)

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
py -m unittest discover -s tests -p "test_p28_same_stop_transfers.py" -v

py scripts/audit_same_stop_transfers.py --first 9106 --second 5106 --date 2026-11-17 --time 22:00 --hours 3
py scripts/audit_same_stop_transfers.py --first 9209 --second 67 --date 2026-11-17 --time 22:00 --hours 3
py scripts/audit_same_stop_transfers.py --first 9209 --second 51 --date 2026-11-17 --time 22:00 --hours 3
~~~

Interpretar timedTransferPairs>0 APENAS como combinações GTFS
com margem no mesmo ponto. Isso NÃO demonstra itinerário
de origem a destino, caminhada, posição GPS, direção desejada,
embarque anterior ou ETA real. Valor zero não exclui troca entre
paradas próximas distintas.

## Próximas rodadas do agente recorrente

1. Ler o estado atual do GitHub Actions e corrigir falhas reais.
2. Rodar esse relatório com catálogo municipal e comparar os horários.
3. Para 9106+5106, localizar a diferença entre oportunidades temporais
   e as candidatas que o verificador OSM descarta. Usar o script
   diagnose_route.cjs com as mesmas coordenadas e data/hora da
   consulta Google/Moovit, sem publicar localização pessoal.
4. Concluir compatibilidade GTFS-RT por instância, stop_sequence
   preservado e fonte original versionada; não inventar frescor
   individual do feed com base apenas no FeedHeader.
5. Integrar horários metropolitanos DER/MG somente com paradas e
   cronologia verificáveis. Não inventar chegada a partir da saída
   do terminal.
6. Atualizar este roadmap com commits, testes, falhas e próximos
   passos a cada rodada. Não fazer merge na main nem deploy sem
   autorização. Evitar conflitos entre múltiplos agentes GitHub.

Restrições permanentes: sem Blaze, VPS, APIs comerciais, serviços pagos,
nem modificações no Hub UFMG, ru-hoje ou repositórios relacionados.

## P28M — Embarque/desembarque possível e auditoria temporal real (20/11/2026)

- **HEAD conferido antes do patch:** `5ab33a244a02d28362ce3f86cd1cd6ac08be3c7d`. Commit de código/testes/CI: **`b7b9e20ed49358c48ceb999ae37c76ec363f8017`**.
- `scripts/audit_same_stop_transfers.py`: não conta desembarque se não houver nenhum stop anterior com pickup permitido e partida cronologicamente anterior; não conta embarque se não houver stop posterior com dropoff permitido e chegada cronologicamente posterior. Cálculo em duas passagens lineares por viagem, sem coordenadas, serviços pagos ou estimativas GPS. Impede falso positivo de perna sem embarque/desembarque.
- `tests/test_p28_same_stop_transfers.py`: regressões sintéticas para origem proibida, destino proibido e inversões cronológicas; preserva cenários de 24h+ e serviços cancelados. Reprodução isolada local: 6 casos de conectividade da perna aprovados. **Suíte integrada remota aprovada**.
- `.github/workflows/integracao.yml`: passa a executar explicitamente a auditoria temporal com shards municipais reais, para referência de **17/11/2026 às 22h**, janela de 3h e espera de 2 a 30 min. Nenhuma coordenada pessoal foi fornecida ou armazenada.
- **Resultados reais** do mesmo catálogo municipal versionado (não representam itinerário ponta a ponta):
  - 9106 + 5106: 22 paradas de `stop_id` idêntico, **24 pares de horários programados** em 6 paradas, 303/411 instâncias ativas (primeira/segunda linha, contadas na janela estendida);
  - 9209 + 51: 0 paradas compartilhadas, **0 pares**; baldeação entre paradas distintas não foi avaliada nesta auditoria;
  - 9209 + 67: 4 paradas compartilhadas, **12 pares de horários** em 2 paradas.
- **CI confirmado no commit de código:**
  - Integração #44750411186: `completed/success`. **149 testes Python**, **159 testes Node/JavaScript**, preview com **9.828 pontos**, auditoria OSM e smoke HTTP aprovados. Link: https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44750411186
  - Testes P2 #44750423189: `completed/success` nas matrizes Python **3.11 e 3.13**. Uma tentativa anterior no mesmo SHA foi cancelada por concorrência; não era falha de testes. Link: https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44750423189
  - P9 Playwright #44750411046: `completed/success`, **21 testes passaram, 3 ignorados**, perfis desktop Chromium e Android emulado 360/390 px. Isso não substitui QA em dispositivo físico. Link: https://github.com/uaibrain-lab/onibusexternobh/actions/runs/44750411046
- **Limitações que permanecem:** 24 combinações para 9106+5106 não validam a origem/destino desejados, nem sentidos, ruas OSM ou acesso a plataformas. 9209+51 necessita caminhar entre paradas diferentes. GTFS-RT ainda não está calibrado/homologado para ETA. DER/MG 411C/511C mantém apenas partidas informativas, sem horários por parada/geometria comprovados e com licença de redistribuição pendente.
- **Handoff:** conferir o HEAD da branch e o CI após este commit documental; obter coordenadas e horários de referência não pessoais, rodar `scripts/diagnose_route.cjs` com diagnóstico por estágio para 9106+5106 / 9209+51 / 9209+67. Depois focar uma correção de roteador fundamentada em GTFS+OSM, em vez de relaxar limites arbitrariamente. Validar instância, `stop_sequence`, calendário e frescor de TripUpdates. Evitar conflitos com outros agentes consultando SHA do arquivo; nunca fazer merge, deploy ou tocar Hub/ru-hoje.
