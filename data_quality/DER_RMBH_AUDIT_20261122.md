# DER-MG RMBH — homologação dos snapshots TXT (22/11/2026)

Fontes: [portal oficial DER-MG](https://www.consultas.der.mg.gov.br/grgx/sgtm/acesso_informacao.xhtml) informa os campos e oferece os TXT. Nesta análise foram usados **os dois arquivos enviados pelo usuário**, disponibilizados na Biblioteca em 19/11/2026. **Essa é a data de upload, não a data de vigência operacional nem a data do download no DER.** Licença específica e data de efetividade **não comprovadas**. Não redistribuir os arquivos sem verificar permissões de reutilização.

## Entradas rastreáveis (SHA-256 dos bytes originais)
- `itinerario_rmbh.txt`: 865.826 bytes; `cf90c84e7093c5480d6118311d62bb37f8118028f2fc10346a90e0a4e6b70343`
- `quadro_horario_rmbh.txt`: 5.472.380 bytes; `b36f38c830c93db04d7c6c0fa6e6e9331b34553868407880a8fc2257199544b0`

## Auditoria local reproduzível
- Itinerários: **809 registros** / **473 chaves** `(COD_LINHA,NUM_LINHA)`.
- Horários: **57.665 partidas** / **648 chaves**.
- Interseção exata: **473 chaves**; horários sem itinerário correspondente: **175 chaves**; itinerários sem horários: **0 chaves**.
- `DESC_PARADA` ausente ou `null` em **587 de 809** registros. Isso não autoriza gerar coordenadas ou GTFS `stop_id`.
- Sufixos dos horários: vazio **51.366**, `PI` **3.066**, `RI` **3.039**, `NT` **192**, `AL` **2**. Seus significados operacionais e vinculação a variantes não foram comprovados.
- **15 valores distintos** em `TIPO_DIA`, entre eles `DIA ÚTIL ATÍPICO`, `DOMINGO FÉRIAS` e `QUARTA-FEIRA CINZAS`. Não converter automaticamente em dias de calendário.
- Formato observado: cabeçalho separado por TAB, registros separados por `;`; linhas de itinerário podem conter quebras de linha e `;` nas descrições de paradas. O cabeçalho tem `TIPO_ITI` adicional, mas cada registro observado tem um campo de tipo; o parser preserva o valor bruto, sem inferir uma oitava coluna.

**Gates:** integridade e identificação documental DER **verificadas localmente**; cobertura de partidas por quadro auditada; **0** jornadas datadas com todos os horários de parada, **0** coordenadas homologadas e **0** viagens GTFS derivadas desses TXT. Os registros têm apenas horário de partida, não tempo completo de passagem em cada parada. Não fazer integração automática ao roteador.

## Execução local (nenhum dado em produção)
```bash
python -m unittest discover -s data_quality -p 'test_*.py' -v
python -m data_quality.der_rmbh_reference --itineraries /caminho/itinerario_rmbh.txt --departures /caminho/quadro_horario_rmbh.txt
```

**Testes realmente executados nesta rodada:** 7 casos `test_der_rmbh_reference.py` aprovados; leitura e auditoria integral de ambos os TXT concluídas em Python local. Os dez testes GTFS anteriormente escritos nesta branch não foram reexecutados nesta rodada. Git terminal sem DNS; publicação pelo conector GitHub.

**Próximo gate do agente de dados:** verificar data/versão e direitos de reutilização dos arquivos na origem oficial; obter feed GTFS metropolitano georreferenciado ou tabela de tempos por parada e calendário operacional compatível. Só então construir jornadas reais verificáveis. O agente principal mantém propriedade exclusiva do roteador, da interface e do deploy.
