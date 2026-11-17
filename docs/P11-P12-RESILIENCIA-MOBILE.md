# P11/P12 — percurso contextual, atualização discreta e resiliência mobile

**Base:** P10. Desenvolvimento isolado de metrô, planejador de rotas e Hub UFMG. **Nenhuma publicação de produção.**

## P11 — Sentidos e percurso escolhidos com contexto

- Na aba **Linhas**, abrir a linha seleciona inicialmente o traçado com **mais viagens cadastradas no GTFS**. É apenas o percurso de referência — não se afirma que o próximo ônibus fará esse itinerário.
- O seletor sempre fica identificado como **Sentido e percurso**, com opções como **Mais viagens**, **Outro sentido** e **Rota alternativa**, sempre exibindo o destino do GTFS. O GTFS não permite universalmente chamar `direction_id=0` de ida e `direction_id=1` de volta; por isso não inventamos esses rótulos.
- Na consulta **Ponto → Linha/Ônibus**, a API passa `stop=<stop_id>`. Cada padrão responde com `servesStop`, e a interface só pré-seleciona traçados que passam **naquele ponto** e, se conhecido, têm **o destino solicitado**.
- Quando há veículo GPS com `shapeMatch.status=probable`, ele ajuda a escolher entre esses padrões; nenhuma outra variante é atribuída por suposição. Se não há correspondência, o seletor informa que não existe itinerário confirmado e permite escolher manualmente.
- O ponto permanece selecionado e centralizado na **área visível** mesmo ao focar um veículo, sem afastamento excessivo.

## P11 — GPS compartilhado e atualizações do PWA

- O motor libera `engine.lock` durante os downloads da PBH. O primeiro solicitante pode aguardar a consulta remota; solicitações concorrentes veem o **último estado conhecido** em vez de ficarem bloqueadas pelo servidor externo.
- Somente um ciclo de coleta roda por vez; respostas são analisadas e aplicadas ao estado de forma serializada. Erro de uma fonte não apaga posições anteriores. Os horários `lastGpsFixAt`, `positionUnchangedSinceAt` e `lastFetchedAt` continuam distintos.
- O service worker agora usa cache `hub-externo-static-p11-r1` e estratégia **network-first com fallback offline** para app shell. **Não armazena** GPS, ETA, API de proximidade nem tiles do OpenStreetMap.

## P12 — foco no passageiro pelo celular

- Atualização periódica do ponto reaproveita os elementos `button.route-arrival` com chave **linha + destino**. O painel e a seção de pontos alternativos não são destruídos a cada consulta, preservando melhor a rolagem, os controles e o estado expandido.
- Quando uma consulta falha, o painel mostra que os horários não foram atualizados. O navegador em modo offline suspende consultas automáticas e retoma ao reconectar.
- Ao recolher o painel mobile, os controles ocultos ficam inertes ao teclado/leitor de tela. A tecla Escape fecha o detalhe ou recolhe o painel, sem interferir com diálogo de favorito.
- Melhorias de tipografia, toque, contraste elevado e rotulagem dos tempos; ETA GPS permanece **aproximado** e horários de tabela são identificados.

## P13 — primeira consulta rápida e leitura segura

- Endpoints `/api/status`, `/api/stop` e `/api/fleet` iniciam `refresh_in_background()` sem aguardar a PBH. O usuário vê imediatamente a última telemetria disponível e/ou a tabela GTFS; a próxima consulta reflete o GPS recém-coletado.
- O serviço expõe `gpsUpdating` para diferenciar **coleta em curso** de **GPS indisponível**. Uma posição GPS antiga nunca é rotulada como atual.
- O calendário e o índice GTFS compactado são carregados uma única vez por processo, protegidos por lock e publicados apenas após leitura integral. Isso evita carregamentos simultâneos duplicados na primeira consulta.
- A API mantém `poll=True` como padrão nos métodos do motor para compatibilidade com os testes e chamadas internas; o servidor HTTP escolhe `poll=False` após agendar a coleta.
- Os testes `tests/test_p13_nonblocking.py` verificam o retorno imediato durante download lento e a leitura GTFS em paralelo.

**Limite:** o protótipo Python local não garante disponibilidade contínua em produção. A hospedagem compartilhada e o monitoramento externo permanecem decisões da integração final.

## Testes

```bash
python -m unittest discover -s tests -v
node --check static/app.js
node --check static/sw.js
node --test tests/test_p11_ui.cjs
```

- `tests/test_p11_resilience.py`: bloqueio de rede externo não paralisa outras consultas, sem duplicar coleta, e variante do trajeto vinculada ao ponto.
- `tests/test_p11_ui.cjs`: classificação de sentido/alternativa, contexto ponto → trajeto, preservação de elementos e cache seguro.

## Limitações para homologar

1. Teste manual Android real de rolagem, teclado, gestos e consumo de bateria permanece necessário.
2. Nenhuma métrica atual comprova a precisão real do ETA com chegadas independentes.
3. O motor de roteamento/multimodal, o metrô e a integração final serão tratados somente ao final do desenvolvimento paralelo.
4. Coleta GPS e atualização de catálogo ainda exigem infraestrutura de produção própria; esta etapa permanece em Python local.
