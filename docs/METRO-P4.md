# P4 — Metrô BH integrado ao Externo (17/11/2026)

## Escopo implementado (sem alterar produção)
Branch: `feat/externo-p4-metro-20261117`, baseada em `feat/externo-hub-p3-pontos-eta`. A `main` e o projeto `uaibrain-lab/ru-hoje` não são modificados.

A aba **Metrô** contém:
- 22 estações distintas em operação cadastradas, sendo 21 na sequência da Linha 1 (incluindo Nova Suíça) e duas no trecho da Linha 2 (Nova Suíça e Amazonas); Nova Suíça pertence a ambas.
- Marcadores geográficos, seleção no mapa, busca por nome, filtro por linha e enquadramento de rota.
- Traçados **esquemáticos** (segmentos retos entre estações); **não** são o desenho real dos trilhos. Não usá-los para navegação de pedestres.
- Funcionamento habitual 05h15–23h e frequências da Linha 1, diferenciando dias úteis, sábado, domingo e a exceção oficial de 16 a 20/11/2026, após 20h (24 minutos).
- **Linha 2** em operação no trecho Nova Suíça–Amazonas. Intervalo geral não confirmado: a aplicação não inventa valor.
- Consulta independente das estações próximas à posição autorizada do usuário e catálogo de até 12 pontos de ônibus em 650 m, com distâncias **em linha reta**, jamais etiquetadas como caminhada.
- Abertura em nova aba da página oficial de previsões por estação para 21 estações incluídas no site da concessionária; Amazonas possui link à página geral.
- Comunicados recentes via RSS oficial, no máximo 6, com cache compartilhado de 30 minutos e estado de indisponibilidade/falha marcado. **Notícia não equivale a alerta operacional ativo.**
- Tarifa divulgada pela operadora, com indicação de verificação. Nenhuma operação de pagamento dentro do site.
- Sem login, geolocalização é opcional, e usuário permanece anônimo.

## Fontes e credibilidade
- Operação e tarifas: https://www.metrobh.com.br/va-de-metro/
- Estações existentes e expansão: https://www.metrobh.com.br/obras/
- Comunicado 16–20/11/2026: https://www.metrobh.com.br/metro-bh-tera-operacao-especial-para-show-da-xuxa-e-aplicacao-do-enem-neste-fim-de-semana/
- RSS: https://www.metrobh.com.br/feed/
- Coordenadas indicativas de 19 estações históricas: dissertação UFMG, tabela 4.1 — https://repositorio.ufmg.br/server/api/core/bitstreams/fdbd8771-500f-4b4b-a375-c942f72e472c/content
- Coordenadas das três novas estações (Novo Eldorado, Nova Suíça e Amazonas): OpenStreetMap contributors, via Mapcarta: https://mapcarta.com/pt/N12263024333 , https://mapcarta.com/pt/N13931210638 e https://mapcarta.com/pt/N13931278795

**NÃO** contém o feed de posições dos trens, GTFS metroviário validado, ETA de trem, hora exata de passagem por estação, alterações operacionais interpretadas automaticamente ou trilhos vetoriais corretos. Esses campos exigem fonte acessível, verificável e atualização contínua. O sistema **não** deve anunciar "previsão em tempo real" com base em frequência média, RSS ou recarga recente.

As estações planejadas Nova Gameleira, Nova Cintra, Vista Alegre, Ferrugem e Barreiro não aparecem como opções para embarque. Alterações do cronograma futuro devem ser verificadas com a operadora.

## API (local e prefixada `/externo/api/*`)
- `GET /externo/api/metro` — estações, linhas, operação habitual, fontes, links oficiais e tarifa
- `GET /externo/api/metro/line?id=1` — sequência de estações e geometria explicitamente esquemática
- `GET /externo/api/metro/station?id=nova-suica` — serviços nas duas linhas + pontos de ônibus próximos
- `GET /externo/api/metro/nearby?lat=-19.92484&lng=-43.97830` — estações próximas em linha reta
- `GET /externo/api/metro/news` — RSS oficial cacheado, indicação de falha/defasagem

As APIs antigas de ônibus da P2/P3 permanecem, sem alteração dos feeds PBH. A API `metro/news` realiza apenas leitura do RSS oficial, não envia coordenadas de pessoas à concessionária nem registra querystrings.

## Como testar
```powershell
py -3 -m unittest discover -s tests -v
py -3 server.py
```
Abrir `http://127.0.0.1:8765/externo/` e selecionar **Metrô**.

Validar no Android, PC e em iframe do Hub antes de integrar; conferir presença, centração, comportamento dos links, desempenho com 9.925 pontos de ônibus e horários divulgados pela operadora. Não realizar deploy de produção nesta fase.

## Próxima etapa — motor multimodal
Quando desenvolver o planejador, cruzar a rede de transporte (ônibus e metrô) com a rede caminhável OSM. O catálogo P4 fornece apenas identificação/ordem das estações; **não** substitui GTFS de trens com viagens e horários, dados de acesso de estação, transferências ou a fonte confiável de ETA.
