# P5 / P6 — Previsão GPS e UX de paradas

## P5: critérios de confiança adicionais

A estimativa GPS é **aproximada**, calculada com telemetria da PBH e geometrias GTFS, não é previsão oficial. Continua exigindo GPS recente, trilha geométrica inequívoca, parada adiante do veículo, velocidade plausível e movimento confirmado. A P5 acrescenta:

- Pelo menos três instantes GPS distintos;
- Rejeitar intervalo entre fixações maior que **100 segundos**;
- Rejeitar salto de progresso geométrico acima de **22 m/s** e regressão do percurso superior a 30 metros;
- Rejeitar a ausência de fixação próxima à última posição considerada;
- Usar horário do GTFS quando o cálculo GPS não é defensável, indicando a origem.

### Medição verificável

A rota de desenvolvimento `/externo/api/eta-diagnostics` expõe **somente em localhost** contagens agregadas de consultas, ETA GPS, horários da tabela e indisponíveis. Não registra coordenadas de visitantes. Ela mede a **cobertura**, não o acerto.

Para avaliar a precisão, `python scripts/backtest_eta.py observacoes.jsonl` aceita registros rotulados por hora efetivamente observada, por exemplo:

```json
{"actualAt":"2026-11-17T08:15:00-03:00","predictedAt":"2026-11-17T08:12:00-03:00"}
```

`predictedAt:null` é ausência de estimativa e conta contra a cobertura. O script calcula MAE, mediana absoluta, p90 de erro absoluto e tendência. **Não invente chegada efetiva a partir da previsão ou do horário programado.** Sem chegada observada independentemente, a precisão real permanece não verificada.

## P6: interface do passageiro

- Ao abrir um ponto, a lista prioritária é **linha, destino e tempo de chegada**;
- Botão Voltar leva à lista de pontos sem perder a posição no mapa;
- A lista geral deixa de mostrar dezenas de linhas ao iniciar; exibe opções quando a pessoa pesquisar;
- Removidos nomes de variantes GTFS e identificadores técnicos dos cartões;
- Horários previstos por GPS mostram `≈` e indicação **Estimativa GPS**; a tabela exibe **Tabela**;
- Preservados geolocalização opcional, favoritos, zoom centrado no ponto ao selecionar ônibus e fallback campus UFMG.

## Testes e limites

```bash
python -m unittest discover -s tests -v
node --check static/app.js
```

O conjunto sintético cobre movimentos válidos, telemetria antiga, GPS parado, saltos e lacunas. Esses testes **não comprovam precisão com veículos reais**. A validação no campo e a hospedagem pública ficam pendentes; a `main` e o Hub UFMG não foram alterados.

O agente que desenvolve P7 deve integrar seu trabalho depois pela revisão da branch P5/P6, sem conflito nesta rodada.
