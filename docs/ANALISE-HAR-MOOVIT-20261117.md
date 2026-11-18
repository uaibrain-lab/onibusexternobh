# Análise de HAR do Moovit — fluxos e oportunidades para o Externo BH

Data da captura: 2026-11-17, aproximadamente 22:15–22:16, Belo Horizonte (UTC−03).
Arquivo original: fornecido pelo usuário **somente na conversa**; **não** incluído no repositório.
Escopo: estudo observacional de requisições capturadas em sessão normal no navegador.
**Nunca copiar cookies, tokens, identificadores pessoais, URL com coordenadas/endereço, credenciais ou payloads brutos do HAR para GitHub.**

## Escopo e limites

- HAR fornecido tem 444 entradas HTTP de muitos domínios; a maioria das
  chamadas irrelevantes corresponde a interface, publicidade ou analytics.
- A captura examina uma viagem entre um endereço em BH e um grande local
  público, às 22:15 do dia 17/11. **Não** é a mesma consulta das 19:58
  que o usuário comparou anteriormente com Moovit.
- Os caminhos abaixo foram observados em respostas, mas são endpoints
  internos NÃO documentados para integração. Não reutilizar em produção,
  não copiar contratos privados nem depender de tokens.
- Dados estruturados explicam o comportamento observável, mas NÃO
  revelam algoritmos ou pesos proprietários do Moovit.

## Arquitetura observável de busca

1. \`POST /index/api/location/search\`: consulta lugares; corpo com
   campos de texto, \`metroId\` e contexto geográfico; resposta com
   \`type, id, title, subTitle, latLng, airDistance, source\`.
   Foram observadas várias consultas por texto parcial. Nosso Photon
   público não deve reproduzir autocomplete contínuo, pois a instância
   externa tem limites de uso.
2. \`GET /api/route/suggested-routes-start\`: envia hora solicitada,
   critério de viagem, modos e coordenadas de origem/destino; resposta
   devolve token efêmero de busca. Não registrar o valor do token.
3. \`GET /api/route/suggested-routes-poll\`: recebe resultados em etapas
   e o sinalizador \`completed\`. No primeiro processo houve resposta
   com \`completed:0\`, seguida de \`completed:1\`. Outra consulta
   terminou numa única resposta. Isso permite apresentar resultados
   progressivos sem bloquear a UI.
4. O resultado agrupa seções de rotas sugeridas, táxi e caminhada.
   Um itinerário contém pernas distintas \`walkLeg\`,
   \`waitToMultiLineLeg\`, \`lineWithAlternativesLeg\` e
   \`pathwayWalkLeg\`; as pernas incluem
   \`time.startTimeUtc/endTimeUtc\`, formas geográficas, sequências
   de pontos/viagens, alternâncias de linhas e metadados de acessibilidade.
5. \`POST /api/lines/arrivals\`: consulta em lote pares de linha + ponto
   (\`lineStopPairs\`). Resposta por ponto inclui \`lineArrivals\`,
   \`staticEtdUTC\`, \`tripId\`, \`patternId\`, sequência de parada,
   posição opcional do veículo e \`nextPollingIntervalSecs=20\`.
   **Isso é diferente de garantir ETA calculado do GPS.**
6. Consultas de mapa usam um serviço de tiles à parte.

## Resultados reais presentes na captura, sem identificação do endereço

| Sequência principal | Duração do itinerário (1º passo → chegada) | Baldeações |
|---|---:|---:|
| 9209 + 9502 + 511C | 39min51s | 2 |
| 9209 + 411C | 42min47s | 1 |
| 9106 + 51 | 52min24s | 1 |

Para 9209 + 9502 + 511C, o tempo de 39min51s se divide em
2min17s caminhando, 28min51s nos ônibus e 8min43s esperando.
Um percurso do tipo 9209 + 411C incluiu caminhada por passagem
interna (\`pathwayWalkLeg\`) de 63 segundos, embora a distância
registrada nesse pequeno segmento fosse ~14,7 metros: a geometria
pode envolver acesso/escada/passagem e não deve ser reduzida a
velocidade reta constante.

**Descoberta crítica: diferença entre duração e tempo desde a consulta.**
A busca começou perto de 22:15, mas o 1º movimento do roteiro de
39min51s começou somente às 22:29:29; chegou 23:09:20.
O tempo desde a consulta à chegada foi de ~54 minutos, NÃO
simplesmente os ~40 minutos mostrados como duração do itinerário.
Expor:
(a) “Viagem: ~40 min”,
(b) “Saída recomendada: 22:29”,
(c) “Chegada prevista por tabela: 23:09”,
(d) opcional “Desde agora até chegar: ~54 min”.
Evitar somar duas vezes a espera inicial.

A captura contém grupo de linhas equivalentes para uma mesma etapa
(\`alternativeLines\`), por exemplo serviços troncais que servem à
mesma transferência: 511C, 411C e 501C foram exibidas como
alternativas numa das pernas, sem exigir um novo card de itinerário
para cada partida. Isso sugere agrupar substituições de linha só
quando pontos/sentido/horário permitirem, não apenas por número.

**Limite da evidência de tempo real:** as pernas dos itinerários
analisados vieram com \`time.isRealTime=0\` e o metadado
\`relevantForRealtime=0\`. O endpoint de chegadas retornou em algumas
entradas \`vehicleLocation\`, mas a captura por si só NÃO comprova
que a viagem completa foi recalculada com atrasos ao vivo.

## Posições repetidas com relógio avançando

- Seis consultas \`/api/lines/arrivals\` apareceram na captura;
  as respostas indicavam intervalo de atualização sugerido de 20 s.
- Em registros repetidos de 16 veículos, a mesma coordenada apareceu
  junto de horários de amostra GPS mais recentes.
- Num exemplo, o horário de amostra avançou cerca de **33,6 segundos**
  sem qualquer mudança da coordenada representada.
- Não concluir que o veículo estava parado, nem que a posição antiga
  está correta. A UI precisa apresentar separadamente:
  \`lastSampleAt\`, \`lastCoordinateChangeAt\`, idade da amostra
  e idade da posição observada. Isso segue a regra já estabelecida
  pelo usuário para evitar “GPS atualizado” enganoso.

## Recomendações de implementação sem APIs pagas

**Prioridade alta**
1. Adicionar nas cartas de rota os dois tempos (duração do itinerário e
   tempo desde o horário de consulta), especialmente quando a partida
   está mais de 3 min no futuro. Manter relógio local fuso BH.
2. Separar “busca GTFS concluída”, “caminhadas validadas”, “GPS opcional”
   e “dados temporariamente indisponíveis”; o primeiro roteiro
   programado pode ser exibido progressivamente, com cancelamento.
3. No painel de ponto/linha, exibir os próximos horários da MESMA
   linha + sentido + padrão. Não confundir \`staticEtdUTC\` com ETA GPS.
4. Persistir idade da **posição** separada da idade da **amostra GPS**.
5. Corrigir a comparação de desempenho com Moovit: exigir mesmos
   endereços, data/hora, sentido, modo de horário, e considerar
   separadamente duração após partida x tempo até chegada desde agora.

**Prioridade média**
6. Representar transferências entre plataformas/corredores como
   caminhada + entrada/saída + tempo de margem, inclusive passagens
   \`pathways.txt\` quando houver dados públicos.
7. Permitir agrupar linhas alternativas de uma mesma perna quando
   realmente intercambiáveis e com mesmo ponto de embarque/destino;
   não inventar serviços/horários que GTFS não suportar.
8. Consultar GPS somente dos veículos/linhas relevantes ao ponto
   aberto, com cache e cadência dimensionados aos limites gratuitos.

## Segurança e limites de conhecimento

O HAR pode conter dados de sessão, coordenadas, endereços e cookies.
O arquivo bruto NÃO foi copiado ao repositório e seus segredos NÃO
devem aparecer em documentação, código, screenshots públicas ou
logs. Estes endpoints observados são contratos internos sujeitos a
mudança, sem permissão garantida para consumo por outros aplicativos.
**Não implementá-los como dependências**. Utilizar dados públicos
GTFS/GTFS-RT/SUMOB e OSM já homologados no Externo BH.

## Próxima fase

Após homologação P23, implementar uma P25 experimental e testável com:
- apresentação simultânea de duração e horário de chegada desde agora;
- agrupamento de linhas alternativas com regras rigorosas;
- verificação de caminhos internos GTFS \`pathways.txt\` quando disponíveis;
- testes que reproduzam a janela de espera anterior ao primeiro passo;
- benchmark reprodutível sem uso dos endpoints privados do Moovit.
