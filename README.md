# Ônibus Externo BH — futuro Externo do Hub UFMG

**Estado:** P9 (continuidade mobile-first) em homologação; **sem deploy público**. O projeto continua independente enquanto o motor P7 é desenvolvido por outro agente. Não mesclar agora com a P7 ou com a branch paralela do metrô.

## Passageiro

- Mapa inicial nos pontos da região da UFMG, sem selecionar linha. A localização pessoal é opcional, mediante permissão, e permite descobrir paradas próximas.
- Pontos agrupados no mapa para reduzir poluição visual; toque para aproximar. Pontos selecionados continuam em destaque.
- Ao abrir um ponto, lista de linhas e próximos horários. Mostra até três partidas **da tabela GTFS** por linha e destino; estimativas GPS aparecem com ≈ quando os critérios de confiança são atendidos.
- Quando um ônibus é selecionado a partir de uma parada, o ponto continua no centro do mapa visível e o zoom mantém um limite de afastamento.
- Compartilhamento por link `?ponto=<ID>` (não compartilha coordenadas da pessoa).
- Favoritos de linhas e pontos, com nomes personalizados locais por navegador e edição por diálogo. Os primeiros cinco pontos favoritos exibem prévia das próximas chegadas, sem precisar abrir cada ponto.
- Botões e textos preparados prioritariamente para telas de celular; tema claro/escuro sincronizável com o Hub UFMG.
- PWA instalável: cache restrito ao shell da interface (HTML, CSS, JS e ícones). **Nunca cacheia GPS, horários dinâmicos, localização nem tiles de mapa**; sem internet, favoritos locais são visíveis, mas chegadas não estão disponíveis.

## Novidades P9 — consulta segura de sentidos e preparação do GTFS

- A mesma linha pode ter **destinos distintos** no mesmo ponto: horários agora são apresentados por **linha + destino**, sem misturar os dois sentidos.
- Se um único traçado GPS corresponder a múltiplos destinos, o ETA GPS não é atribuído a nenhum destino sem confirmação.
- O painel oferece, quando houver, **outros pontos próximos com destinos diferentes**; a interface não supõe um lado específico da avenida.
- Fonte de leitura e controles maiores nas chegadas para operar com uma mão no celular.
- Ferramenta de renovação do GTFS com **validação antes da instalação local**: `python scripts/update_gtfs.py --archive ARQUIVO.zip`. Sem ativação automática, sem alterar produção.
- Consulte [docs/P9-DIRECOES-ATUALIZACAO.md](docs/P9-DIRECOES-ATUALIZACAO.md) para limites e testes.

## Verdade e disponibilidade dos dados

O GPS de ônibus da PBH é separado de uma coleta HTTP: `lastGpsFixAt`, `positionUnchangedSinceAt` e `lastFetchedAt` possuem semânticas diferentes. A P5 recusa estimativas quando sinais, sentido, movimento, geometria ou distância não permitem confiança. Os horários de tabela **não confirmam veículo em operação**. A marcação de última partida considera somente o serviço programado, não uma garantia operacional.

A base GTFS atual deve ser substituída automaticamente por versões válidas antes do vencimento de calendário. Ainda não há coletor público, atualização automática do GTFS ou medições de acerto contra chegadas observadas. A API do Python é um protótipo local e não roda diretamente no Firebase Hosting estático.

## Execução e testes

Python 3.9+ na raiz do repositório:

```powershell
py -3 -m unittest discover -s tests -v
py -3 server.py --open
```

Abra `http://127.0.0.1:8765/externo/`.

O mapa utiliza tiles de terceiros quando há internet. O conteúdo GTFS é estático e os horários são atualizados por arquivo, não por rede de usuários. Não permitir escrita pública dos dados oficiais. Não pré-baixar tiles do servidor público OpenStreetMap para uso offline.

**Documentação:** `docs/P4-PREVISAO-GPS.md`, `docs/P5-P6-HOMOLOGACAO.md`, `docs/P8-MOBILE-FIRST.md`.

**Próximas etapas separadas:** validar previsões de GPS com chegadas observadas, geocodificação de plataformas/sentidos, alertas apenas a partir de fonte oficial, hospedagem gratuita e atualização automática do catálogo. Integração com a P7 e o Hub ficará para depois.
