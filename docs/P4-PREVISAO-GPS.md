# P4 — Previsão por GPS e navegação ponto → ônibus

**Escopo:** protótipo de homologação; não alterar o Hub UFMG publicado nem sua aba Interno.

## Fontes
- Dados de posição: API pública de coordenadas PBH/SUMOB, convencional/MOVE e suplementar.
- Linhas, paradas, calendários e geometrias: GTFS oficial.
- A posição recebida em uma nova consulta não significa que o veículo se moveu.

## ETA por GPS
O arquivo `transit/eta.py` fornece uma **estimativa aproximada**, não uma previsão oficial de chegada. Exige simultaneamente:
- GPS recente (até 90 s) e a posição não pode estar congelada há mais de 150 s;
- pelo menos três sinais GPS independentes e deslocamento comprovado;
- correspondência geométrica conservadora do histórico com uma única variante de itinerário;
- parada presente exatamente uma vez no padrão de viagem e localizada na geometria;
- veículo ainda antes da parada, no mesmo sentido, com progresso consistente;
- velocidade longitudinal plausível e horizonte estimado de até 30 min.

Se falhar qualquer condição, a interface usa o **horário programado** do GTFS, quando disponível, identificado como tal, sem inventar precisão GPS.

Quando uma previsão GPS é confiável, ela traz internamente `vehicleId` e `vehicleSource` para permitir localizar o ônibus correspondente no mapa. Esses códigos não precisam ser mostrados ao passageiro.

## Mapa e foco
- O mapa inicia pelos pontos, sem linha selecionada e com campus UFMG como referência quando não há permissão de localização.
- Botão de recentrar prioriza a localização do usuário, mediante autorização; alternativa é campus UFMG.
- Ao selecionar um ônibus a partir de um ponto, o ponto permanece no centro **da área visível**, fora da sobreposição do painel lateral/inferior.
- O zoom para na faixa 14,5 a 16; caso o veículo esteja mais distante, uma seta na borda indica a direção relativa. Não diminuir o zoom até ocultar o ponto.
- Recalcular o alinhamento depois de expansão do painel e redimensionamento.

## Limitações
- ETA não incorpora trânsito ao vivo, cancelamentos nem operação oficialmente confirmada.
- A associação veículo → itinerário pode continuar ambígua; nesses casos, nenhum ETA GPS é exibido.
- O cache local é compartilhado por processo; hospedagem e atualizações em produção não estão implementadas.
- O teste visual automatizado do protótipo em localhost está bloqueado neste ambiente; homologação visual em navegador real continua pendente.
