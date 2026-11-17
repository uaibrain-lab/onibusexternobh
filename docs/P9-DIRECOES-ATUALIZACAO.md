# P9 — Direções, pontos próximos e renovação controlada de GTFS

Escopo **independente**: branch baseada na P8. Não mesclar com metrô, planejamento de rotas P7, `main` ou Hub UFMG nesta rodada.

## Passageiro (mobile-first)

- A chegada é exibida por **linha + destino/headsign GTFS**, nunca por linha apenas quando houver dois sentidos distintos na mesma parada. O horário de tabela de um sentido não pode substituir automaticamente o do outro.
- Se o GPS determinar um traçado mas esse traçado servir destinos diferentes, a estimativa GPS é recusada. Aplica-se o horário da tabela daquele destino, quando existente.
- As informações de destino passaram a ter mais destaque e fontes maiores para telas estreitas.
- Quando houver outras paradas a até **100 m** com a mesma linha e destino anunciado diferente, o painel oferece uma seção **recolhida** “Outros pontos próximos”. Ela permite navegar até o ponto vizinho sem poluir a consulta inicial.
- **Importante:** proximidade geométrica e headsign não comprovam lado da avenida, plataforma, sinalização ou acessibilidade. Nunca exibir “lado oposto” ou “plataforma X” sem fonte oficial.

## Catálogo GTFS — preparação para renovação

`python scripts/update_gtfs.py --archive ARQUIVO.zip` valida o ZIP recebido sem alterar o catálogo; se omitir `--archive`, baixa o arquivo oficial por HTTPS. Valida arquivos essenciais, consistência referencial, integridade dos horários, manutenção de cobertura significativa de linhas/paradas e calendário com ao menos sete dias seguintes. Regenera todos os JSONs e o índice de horários em uma área temporária. Os relacionamentos GPS→linha são **recalculados** contra os novos `route_id` a partir dos códigos públicos já conhecidos, sem inventar variantes.

Somente `--apply` substitui os arquivos locais, após validação; faz backup e restauração caso alguma substituição falhe. Execute com o servidor desligado. Para produção, a estratégia final deverá ser a troca **atômica de diretórios versionados**, que ainda não foi implementada.

Exemplo local (Windows PowerShell):

```powershell
py -3 scripts\update_gtfs.py --archive D:\Downloads\GTFSBHTRANS.zip
# Somente após revisar os resultados e fechar o servidor:
py -3 scripts\update_gtfs.py --archive D:\Downloads\GTFSBHTRANS.zip --apply
```

**Não há job automático ativo.** A validação com fixture pequena e os testes unitários passaram; o processamento completo do GTFS antigo excedeu o tempo disponível neste ambiente e ainda precisa de homologação de desempenho. Nenhum catálogo em produção foi substituído.

## Alertas operacionais

Não foram adicionados avisos sobre atrasos, greves ou interrupções: **não há feed de alertas verificado e integrado nesta branch**. Não inferir eventos oficiais apenas de ausência de GPS ou horários de tabela. Integrar avisos apenas quando houver fonte oficial acessível, com expiração e atribuição da origem.

## Testes

```bash
python -m unittest discover -s tests -v
node --check static/app.js
python -m compileall -q transit scripts server.py tests
```

Testes adicionais verificam destinos separados, não associação indevida de GPS, pontos vizinhos sem inventar plataforma e catálogo novo validado antes de tocar o antigo.
