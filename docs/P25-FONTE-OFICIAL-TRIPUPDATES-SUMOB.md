# Investigação P25 — Fonte oficial de TripUpdates, alternativa aberta aos dados privados de Moovit/Google

**Estado em 17/11/2026:** pesquisa concluída; validação do conteúdo BINÁRIO EM TEMPO REAL pendente.
**Escopo:** somente onibusexternobh, branch feat/gps-worker-free-homologacao-p15-20261117; sem mudanças no Hub, GPS Worker publicado, deploy ou consumo pago.

## 1. Descoberta principal — os dados já têm publicação oficial

SUMOB/PBH publica GTFS-RT sob licença de atribuição (CC BY 4.0):
- TripUpdates: atrasos, cancelamentos, mudança de percurso e, se presentes,
  horários de chegada e saída por ponto;
- VehiclePositions: coordenadas e metadados do veículo;
- ServiceAlerts: alterações de serviço.

Catálogo oficial:
https://dados.pbh.gov.br/dataset/gtfs-rt
https://ckan.pbh.gov.br/dataset/gtfs-rt

Metadados e licença espelhados pelo Transitland:
https://www.transit.land/data/feeds/f-7h2w-empresadetransportesetransitodebelohorizontes~a~rt
https://github.com/transitland/transitland-atlas/blob/main/feeds/dados.pbh.gov.br.dmfr.json

As URLs de TripUpdates, VehiclePositions e Alerts estão publicadas nos
metadados acima. URL nominal de TripUpdates:
http://realtime4.mobilibus.com/web/4ch6j/trip-updates?[parâmetro público publicado]
NÃO copiar parâmetros de acesso para HAR, logs ou repositório novo;
usar o endereço completo obtido dos dados abertos somente em variável
de ambiente local. Não criar proxy de URL arbitrária.
A licença registrada permite derivados e redistribuição, mas exige
atribuição explícita: "Superintendência de Mobilidade Urbana de Belo Horizonte (SUMOB)".

O GTFS estático oficial tem download fixo:
https://s3.amazonaws.com/mobilibus-uploads/gtfs/GTFSBHTRANS.zip
O catálogo registra atualizações periódicas e serviço até 2026-12-31;
não confundir validade do calendário com atualidade do feed.

## 2. Indício público de conteúdo *real* de TripUpdates

Um coletor acadêmico independente observou aproximadamente 400 entidades
por consulta, em geral com um único StopTimeUpdate por viagem (próxima
parada), incluindo trip_id, route_id, direction_id, stop_sequence, stop_id,
arrival.delay ou departure.delay:
https://github.com/juliaandradel/gtfs-rt-collector/blob/main/gtfs-rt-collector/coletor.py

**Atenção:** observação de terceiros, NÃO foi validada hoje no feed.
O resultado pode variar conforme horário, serviço e qualidade da fonte.
TripUpdate com uma parada de atraso não equivale a ETAs oficiais de
todas as paradas seguintes. A especificação GTFS-RT permite propagar
delay em condições definidas; previsão exibida deve distinguir:
- "Horário programado" (estático)
- "Atualizado pela SUMOB" (hora absoluta em StopTimeUpdate)
- "Estimado com atraso informado" (propagação do delay, incerteza)
- "Indisponível" (dados ausentes/velhos/não associados)

Documentação:
https://gtfs.org/documentation/realtime/reference/
https://gtfs.org/documentation/realtime/trip-updates/

## 3. Diagnóstico de conteúdo: implementado, SEM coleta contínua

Novo script: scripts/probe_sumob_trip_updates.py
- Uma única requisição, sem loop, escrita, GPS individual ou dados pessoais.
- Dependência local open source gratuita: gtfs-realtime-bindings.
- Só aceita host e caminho oficial de TripUpdates; não segue redirects.
- Limita body a 8 MiB e timeout a 15s; não imprime tokens.
- Resume quantas viagens/linhas/paradas, atraso vs hora absoluta,
  cancelamentos, timestamps e quantas paradas por viagem.
- Pode ler arquivo .pb local quando a origem for inacessível.

Novo teste offline `tests/test_probe_sumob_trip_updates.py` verifica contagens, atrasos, segurança da URL e ausência de falsa conclusão de "sem ônibus". Ele usa respostas sintéticas e não requer rede. **Ainda precisa ser executado no Windows do usuário.**

No PowerShell Windows, executar:

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
py -m unittest discover -s tests -p "test_probe_sumob_trip_updates.py" -v
py -m pip install gtfs-realtime-bindings
# Cole no comando a URL oficial COMPLETA publicada no catálogo GTFS RT
$env:SUMOB_TRIP_UPDATES_URL = 'COLE_A_URL_PUBLICA_COMPLETA_AQUI'
py scripts/probe_sumob_trip_updates.py
Remove-Item Env:\SUMOB_TRIP_UPDATES_URL
~~~

Se der HTTP 403/502 de uma rede, NÃO contornar proteções. Comparar
acessibilidade com Worker homologado que já conseguiu VehiclePositions
ou consultar SUMOB sobre acesso autorizado. Registrar resultado como
indisponível, não "sem ônibus". Não publicar o Worker ainda.

## 4. Decisão de arquitetura após medir o feed

SE demonstrar TripUpdates presentes e atuais:
- Validar GTFS estático: route_id pode ser código público ("5102") e
  não route_id interno ("562055"), conforme ocorreu em VehiclePositions.
  Fazer correspondência por trip_id, start_date/start_time,
  stop_sequence/stop_id e direction_id; NÃO por código isolado.
- Pegar TripUpdates da SUMOB somente sob demanda (usuário seleciona
  ponto/linha/itinerário), compartilhar resposta no Worker Free com
  cache curto de 25–45s, filtrar por linhas/pontos pertinentes.
- Descarta timestamps futuros >2min ou vencidos, padrões equivocados
  e dados com NO_DATA/SKIPPED/CANCELED. Interpretar corretamente GTFS
  24:xx e zonas/serviço atravessando meia-noite.
- Mantenha fallback offline de horários programados.
- Monitorar CPU do Worker e pedidos diários.
- **Nenhum ETA GPS inventado:** propagar delay somente quando a
  especificação permitir e sempre rotular como estimativa.

SE a maioria das viagens não tiver previsões:
- Priorizar tabelas e posições com idade correta, melhorar ETA apenas
  de forma opt-in e com incerteza visível.
- Solicitar dados operacionais adicionais e mecanismos de acesso à SUMOB.

## 5. Limites Free (confirmados em documentação Cloudflare nov/2026)

Workers Free: 100.000 invocações/dia e 10ms CPU/invocação,
128 MiB RAM; o cache API é local ao PoP e não resolve atualização
global automaticamente. Não usar Workers Paid, Blaze, R2 pago,
VPS, API Moovit ou Google como dependência obrigatória.

Fontes:
https://developers.cloudflare.com/workers/platform/limits/
https://developers.cloudflare.com/workers/reference/how-the-cache-works/

## 6. Pedido LAI se precisar de informação adicional

Ofício direcionado à SUMOB (protocolo na PBH via serviço de acesso à
informação) solicitando cópias ou links já existentes, sem exigir
produção de um relatório novo:

1. Relação dos feeds/datasets de horários atualizados, atrasos
   por parada/viagem, desvios, cancelamentos, serviços GTFS e GTFS RT
   atualmente disponibilizados a integradores de terceiros.
2. Especificação dos IDs/chaves de correspondência entre GTFS estático,
   realtime, trajetos de veículo, ponto e padrão de itinerário.
3. Documentos existentes que definem cadência de atualização, retenção,
   qualidade, limites e regras de acesso/licença.
4. Cópias de convênios ou documentos públicos de fornecimento de dados
   de mobilidade a plataformas privadas (se existirem), suprimindo
   credenciais ou informações legalmente protegidas.

Portal: https://prefeitura.pbh.gov.br/lei-de-acesso-a-informacao
Prazo: 20 dias, prorrogáveis por 10, conforme PBH.
Não presumir que Google/Moovit receberam feed mais rico da SUMOB;
isso é ponto para esclarecer, não fato comprovado.

## 7. O que está confirmado e o que falta

- CONFIRMADO: SUMOB registra GTFS-RT como dado aberto CC BY.
- CONFIRMADO: Worker Externo BH já conseguiu HTTP 200 para
  VehiclePositions oficial (testes anteriores do usuário).
- EVIDÊNCIA DE TERCEIROS: TripUpdates pode ter 1 parada por viagem.
- NÃO CONFIRMADO NESTA RODADA: leitura binária do TripUpdates ao vivo,
  qualidade de cobertura por linha/ponto e compatibilidade com GTFS.
  As tentativas de acessar a origem deste ambiente não obtiveram
  payload binário; não inferir feed vazio/fora do ar por isso.
- SEM DEPLOY: apenas script de diagnóstico + este relatório na branch.
- Próxima IA: após execução do diagnóstico, registrar números reais
  e implementar um leitor protótipo no Worker separado, sem habilitar
  no cliente antes de homologação, preservando o plano gratuito.
