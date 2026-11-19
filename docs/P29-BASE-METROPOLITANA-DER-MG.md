# P29 — Fontes oficiais DER/MG e gate de cobertura metropolitana (19/11/2026)

## Resultado da pesquisa independente

Fonte primária oficial: https://www.consultas.der.mg.gov.br/grgx/sgtm/acesso_informacao.xhtml
O DER/MG publica **Quadro de Horários RMBH** e **Itinerários RMBH** em texto (resposta pública via Lei de Acesso à Informação confirmada em https://www.der.mg.gov.br/1323-transparencia/respostas-portal-da-transparencia, protocolo 02301000020202073).

Dicionário publicado pelo DER/MG:
- `quadro_horario_rmbh.txt`: COD_LINHA, TIPO_DIA, NOME_QUADRO, HORA_PARTIDA, NUM_LINHA, NOME_LINHA.
- `itinerario_rmbh.txt`: COD_LINHA, NUM_LINHA, NOME_LINHA, TIPO_ITI, NOME_ITI, DESC_ITI, DESC_PARADA.

Consulta individual oficial: https://www.consultas.der.mg.gov.br/grgx/sgtm/consulta_linha.xhtml
Portal Minas Gerais descreve consulta de linhas, horários, itinerários e pontos:
https://www.mg.gov.br/servico/obter-informacoes-sobre-o-transporte-coletivo-da-regiao-metropolitana-de-belo-horizonte

Fonte secundária de demanda (NÃO serve para rotas/horários):
https://dados.mg.gov.br/tl/dataset/seinfra_demanda-onibus-metropolitano

## Limites e bloqueios reais

- Página primária indexada e dicionário verificado por busca, mas acesso HTTP automatizado ao XHTML nesta execução retornou 403. **Nenhum snapshot bruto dos dois TXT foi obtido ou validado; não alegar cobertura DER implementada**.
- Dados de partida (`HORA_PARTIDA`) **não** contêm horários GTFS de chegada/passage por cada parada.
- `DESC_PARADA` não oferece por si só coordenadas, IDs GTFS ou geometria OSM de travessia. Não geocodificar descrições e fingir precisão.
- A licença de redistribuição dos arquivos brutos e o formato/delimitador/charset efetivos ainda precisam ser confirmados antes de publicar derivados.
- 411C/511C ausentes do catálogo GTFS municipal original (ver P27C). Não associar automaticamente dados metropolitanos aos IDs e calendários da SUMOB.

## Gate para uma integração offline-first e hospedagem gratuita

1. Obter manual ou automaticamente, por acesso permitido, os dois arquivos **do site oficial**, guardar origem, data da extração e SHA-256, tamanho e codificação em manifesto. Não inserir credenciais, cookies ou links de sessão no repositório.
2. Inspecionar amostra REAL antes de escolher delimitador, tipos de dia e codificação; testar parser com arquivo bruto e fixtures redigidos, preservar `COD_LINHA` e os nomes distintos de quadro/itinerário.
3. Converter somente **partidas comprovadas na origem**. Para cada itinerário, comparar `DESC_PARADA` com catálogo oficial georreferenciado e sequência direcional; sem confirmação, registrar cobertura como "horários/itinerários informativos", sem rotas ponto a ponto.
4. Validar pelo menos 411C e 511C contra consultas oficiais, em dia útil/sábado/domingo/feriado conforme documentação real do `TIPO_DIA`; não inventar calendários.
5. Só ligar ao planejador quando houver identificação de paradas e geometrias verificáveis, horários por parada comprovados, transferências OSM por vias caminháveis, testes integrados e licença de reutilização adequada.
6. Produzir shards estáticos sob demanda, com orçamento de tamanho e versionamento do catálogo; não introduzir Blaze, VPS, API paga ou coleta de GPS.

## Estado/handoff

- Branch exclusiva: `feat/gps-worker-free-homologacao-p15-20261117`; sem merge/deploy.
- Pesquisa concluída, **integração DER pendente de arquivos oficiais íntegros**. Próximo agente deve verificar primeiro HEAD, CI e SHA dos arquivos, buscar o download exato no DER e validar os campos/delimitadores originais antes de editar qualquer conversor.
- Paralelamente, P28L criou decodificação offline de TripUpdates e adapter estrito para instância/stop. Isso **não ativa ETA**, nem implica cobertura metropolitana.
