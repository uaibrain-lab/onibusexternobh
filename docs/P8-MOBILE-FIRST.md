# P8 — melhorias independentes mobile-first

Branch baseada na P5/P6. Não altera a P7, a integração do metrô, a branch principal ou o Hub publicado.

## Funcionalidades
- Paradas próximas agrupadas em níveis distantes de zoom; tocar o grupo aproxima o mapa. Ponto selecionado permanece destacado.
- Até três **horários da tabela** por linha, sem tratar as partidas programadas como ônibus confirmados. A última partida conhecida do dia de serviço pode receber aviso próprio.
- Compartilhamento de paradas com parâmetro `?ponto=<id>` e Web Share / cópia de link; links não incluem a localização do passageiro.
- Favoritos com nome próprio, guardados só neste navegador, editáveis em modal sem `prompt()`. Até cinco pontos favoritos recebem uma prévia das próximas chegadas (GPS estimado ou tabela, conforme fonte).
- Acessibilidade mobile: alvos de toque de 44 px, horários e textos maiores, safe areas e redução de movimento.
- Indicador global derivado de GPS realmente recente e integridade de fontes, não apenas de HTTP consultado.

## Limites importantes
- O histórico de horários **não prova que o ônibus está rodando**.
- O indicador de última viagem considera o dia de serviço do GTFS; não confirma operação.
- A previsão GPS permanece conservadora e não foi homologada com chegadas observadas em campo.
- PWA, renovação automática do GTFS, alertas oficiais e infraestrutura pública continuam pendentes; integração com P7 e metrô foi explicitamente adiada.

## Testes

`python -m unittest discover -s tests -v` e `node --check static/app.js`.
