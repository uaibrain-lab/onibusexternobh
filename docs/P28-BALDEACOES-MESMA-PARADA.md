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
