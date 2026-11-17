# P10 — Desempenho mobile e catálogo GTFS seguro

Branch independente baseada na P9. **Não integrar agora** ao metrô, ao motor de rotas P7 nem ao Hub UFMG em produção.

## Desempenho do mapa no celular

- Índice espacial da API em células geográficas (~1,1 km em BH) para as consultas de paradas próximas e do mapa. Para áreas enormes, cai para busca geral.
- Se houver mais de 750 pontos visíveis, a API retorna os mais próximos do centro do mapa e sinaliza `truncated`.
- A interface reutiliza pontos de uma área já carregada quando a pessoa arrasta o mapa por uma pequena distância. Consultas anteriores são canceladas ao trocar de região.
- Limite de resolução do canvas em aparelhos de até 3 GB: 1,35×; demais: 1,75×. Cache de tiles: 72/120, respectivamente.
- O redesenho periódico foi reduzido para a cada 15 segundos **somente quando há veículos**, evitando gastar bateria ao exibir apenas um mapa estático. A atualização de GPS e do painel de chegadas não foi diminuída.
- Nenhum tile do OpenStreetMap é armazenado antecipadamente para uso offline.

## Validação real do GTFS

Validado com `GTFSBHTRANS.zip` da versão `202611161919` (16/11/2026):
**326 linhas, 9.925 pontos, 113.692 viagens, 6.691.004 stop_times**.
A validação completa foi executada em modo sem alterações e aprovada. Não houve atualização de catálogo em produção.

## Atualização por versões

```bash
# Dry-run: NÃO altera catálogo em uso
python scripts/update_gtfs.py --archive GTFSBHTRANS.zip

# Em homologação: instalar snapshot completo e ativar no próximo restart
python scripts/update_gtfs.py --archive GTFSBHTRANS.zip --apply

# Em homologação: voltar à versão anterior no próximo restart
python scripts/update_gtfs.py --rollback
```

O atualizador gera as oito dependências em diretório temporário, publica os arquivos juntos em `catalog/versions/<version>-<hash>/` e muda apenas `catalog/active.json` atomicamente. O servidor resolve o diretório na inicialização; um processo existente continua a usar a versão antiga. O catálogo legado é preservado para rollback. O instalador não faz backups semanais nem exclusões automáticas dos snapshots ainda em uso.

**Importante:** não executar atualizações simultâneas no mesmo catálogo. Execução periódica, recuperação automática em produção e ativação sem restart dependem da definição da hospedagem e ficam desativadas até a integração final.

## Testes e limites

```bash
python -m unittest discover -s tests -v
node --check static/app.js
```

As previsões GPS permanecem aproximadas. Não foram adicionados falsos avisos de desvio, suspensão, plataforma ou tempo real: alertas operacionais exigem fonte oficial verificável. Testes em Android físico e medição do consumo de bateria/rede continuam pendentes.
