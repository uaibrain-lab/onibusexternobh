# P21 — Estado do rastreio por linha, busca de locais e qualidade do roteamento

Data: 17/11/2026. Branch: feat/gps-worker-free-homologacao-p15-20261117.
PR #19 (draft). SEM merge, SEM deploy no Hub/ru-hoje/Firebase.

## Problemas relatados no teste de homologação

1. Depois de abrir uma linha, o mapa continuava mostrando pontos não
   pertencentes ao percurso. Ao voltar às abas, o rastreio da linha
   permanecia ativo, perdendo o mapa e o ponto previamente selecionados.
2. Linha aberta fora de um ponto deveria permitir escolher um ponto de
   embarque e usar o ponto mais próximo caso a pessoa já tivesse concedido
   acesso à localização.
3. Busca de origem/destino não pesquisava endereço, número ou estabelecimento.
4. Consulta de 17/11 aproximadamente às 19:58 produziu, entre outros:
   - 9106 + 9502 + 63 = 56 min;
   - 9106 + 9502 + S70 = 57 min;
   - 9106 + 5106 = 66 min.
   O usuário viu no Moovit, para a consulta que considera equivalente:
   - 9209 + 5106 = 36 min;
   - 9106 + 5106 = 39 min;
   - 9106 + 51 = 45 min.
   Os ENDEREÇOS exatos de origem/destino, datas, critérios de partida e
   tratamento de chegada não estão registrados nesta mensagem; não é
   possível certificar equivalência nem prometer esses mesmos tempos.
   Moovit pode usar outros calendários e dados de tempo real.

## Alterações implementadas

### Mapa, linha e seleção de ponto

- Seleção da linha cria sessão de visualização com tab anterior, zoom e
  centro, sem destruir o detalhe do ponto previamente aberto.
- Enquanto a aba Linhas acompanha um percurso, somente paradas do
  percurso selecionado são desenhadas; a consulta geral de paradas não
  pode reexibir pontos alheios após retornar assincronamente.
- Fechar linha restaura o mapa anterior e retorna ao ponto aberto ou à
  aba Linhas normal. Trocar de aba sai automaticamente do rastreio.
- Mudança de sentido invalida o ponto anterior quando não participa do
  novo percurso, e sugere o mais próximo se houver localização autorizada.
- Sem permissão, a pessoa seleciona o ponto diretamente pelo seletor da
  linha. O estado nunca faz uma nova solicitação automática de permissão.
- Horários mostrados por ponto vêm da tabela GTFS. Não são ETA GPS,
  porque a fonte SUMOB fornece posição, mas não valida o sentido/trip.

### Origem e destino por endereço ou comércio

- Novo static/place-geocoding.js: consulta Photon / OpenStreetMap SOMENTE
  após toque em Buscar local, nunca autocomplete a cada tecla.
- Busca usa texto digitado, limite 6 resultados, bounding box de BH e
  viés geográfico FIXO no centro da cidade, não envia localização GPS.
- Serviço demo gratuito de uso moderado, pode limitar requisições.
  Cache por aba por 30 min, espera mínima de 1300 ms entre buscas
  distintas, sem retries de fundo. Fallback para catálogo GTFS local,
  seleção no mapa e coordenadas caso Photon falhe.
- A busca digitada é enviada ao serviço externo apenas mediante ação
  explícita, com informação visível na tela. O cálculo GTFS continua
  em Web Worker no dispositivo, sem backend pago.
- Nominatim público deliberadamente NÃO utilizado para evitar conflito
  com suas políticas de limite e proibição de autocomplete/integradores.
- Documentação Photon: https://github.com/komoot/photon
  https://github.com/komoot/photon/blob/master/docs/api-v1.md

### Roteamento GTFS

- Aumentada cobertura de paradas perto da origem e destino: busca padrão
  até 1100 m/48 candidatas; ampliada até 1450 m/80 candidatas.
- Conexões a pé entre paradas permitem raio reto até 300 m e 18
  candidatos; apenas itinerários com caminhadas verificadas no grafo
  OSM são mostrados quando o grafo está disponível.
- A pré-seleção antes do grafo de rua passou de 32 para 56/96 candidatos
  (normal/ampliada). Antes, múltiplas variações de uma mesma combinação
  podiam expulsar 9106+5106 antes da validação de caminhadas.
- Seleção final mantém a opção mais rápida e diversifica as combinações
  de linhas nas seis opções. Estatísticas incluem candidatos avaliados
  e rejeitados por restrição de caminhos de pedestres.
- NÃO foram fabricados horários, nem calibrado tempo para imitar o Moovit.
  O horário programado GTFS e as vias OSM continuam sendo a base.
- **Pendente:** benchmark reproduzível com as coordenadas exatas,
  data/hora idênticas, e interpretação das partidas de Moovit; testes
  em aparelho real, desempenho da busca ampliada e comparação de
  cada perna/caminhada, incluindo as linhas 9209, 5106 e 51.

## Arquivos e testes

Arquivos: static/app.js, static/index.html, static/route-worker.js,
static/place-geocoding.js, static/service-worker.js,
static/hub-parity.css, scripts/build_static_site.py,
scripts/Publicar-GPS-Homologacao.ps1.

Novos testes:
- tests/test_p21_line_map.cjs (regressão da sessão/mapa/ponto);
- tests/test_p21_geocoder.cjs (endereço, privacidade e limites);
- tests/test_p21_route_ranking.cjs (diversidade/limites);
- tests/browser-p21-line-routing.spec.cjs (interface com Photon simulado).

O assistente fez testes isolados de sintaxe JS, restauração e ranking
em JavaScript VM e busca Photon simulada; **a suíte Node e Playwright
completas ainda devem ser executadas via ambiente real**.

### Próxima validação local e deploy SOMENTE na homologação

```powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117

node --test tests/test_p21_line_map.cjs tests/test_p21_geocoder.cjs tests/test_p21_route_ranking.cjs tests/test_static_worker.cjs

powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Publicar-GPS-Homologacao.ps1" -Publicar
```

O script já executa testes, faz build novo e só publica no projeto Pages
externo-bh-hml-uaibrain. NÃO usar -ReutilizarBuild nesta atualização;
NÃO usar -AtualizarWorker nem -CriarProjeto.

Após publicar, conferir pelo Chrome/Android:
- Pontos comuns desaparecem ao abrir 5102;
- percursos diferentes usam paradas próprias;
- botão Fechar linha e troca de aba restauram mapa e detalhe;
- selecionar um ponto exibe próximos horários de tabela sem ETA inventado;
- pesquisa por "Rua Santa Marta 567", faculdade, estabelecimento;
- usar mesmos endereços, horário e data na comparação com Moovit;
- ausência de regressão visual em 360/390 px e PC, carga de JS/GTFS.

## Política de atualização do roadmap

Toda nova fase deve registrar: commit(s), testes efetivamente executados,
testes pendentes, divergências de horários, funcionalidade nova,
bloqueadores e estado real de deploy. Não confundir "committed" com
"publicado". Sem alterações no Hub principal sem autorização explícita.
