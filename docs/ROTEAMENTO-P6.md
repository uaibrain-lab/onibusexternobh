# P6 — Precisão do planejador (desenvolvimento)

Branch: `feat/externo-p6-precisao-20261117` (base: P5). Não há deploy de produção.

## Correções efetivamente implementadas

- Índice GTFS schema 3 preserva **pickup_type** e **drop_off_type** em cada passagem de cada viagem. Não oferecer embarque/desembarque quando a operadora proíbe ou exige serviço especial.
- O mecanismo explora todas as 326 linhas presentes no índice ao longo da pesquisa, sem o corte inicial arbitrário em 135 rotas; a consulta do dia 18/11/2026 alcançou 3 rodadas sem atingir o limite global de paradas examinadas.
- Otimizações de seleção de viagem e rótulos de dominância entre rodadas, mantendo chegada, caminhada e número de embarques como objetivos separados.
- Quando a busca poda rótulos por proteção de recursos, retorna `status: partial` (não promete solução global ótima).
- Testes sintéticos adicionais simulam ônibus que passa pelo ponto mas proíbe embarque ou desembarque.
- Módulo opcional de verificação de pedestres com servidor **Valhalla local**. Se houver serviço configurado, recusa itinerários cuja caminhada não existe na rede de ruas ou inviabiliza a transferência temporal.

## Ativar roteamento real de pedestres

O serviço **não é incluído nem hospedado automaticamente**. É necessário provisionar uma instância própria de Valhalla com dados OpenStreetMap atualizados e perfil pedestre. Depois de verificá-la:

    $env:PEDESTRIAN_ROUTER_URL = "http://127.0.0.1:8002"
    py -3 server.py

O backend só aceita endereços de loopback. Em nenhum momento usa um servidor público de teste para enviar coordenadas dos usuários sem aprovação.

Sem a instância local, o site mantém caminhada aproximada, explicitamente identificada. A disponibilidade do mapa base OSM não implica que o motor conheça ruas caminháveis.

## Resultados e limites

- CATÁLOGO: GTFS oficial de Belo Horizonte, 326 linhas, 113.692 viagens, 6.691.004 registros de passagem, validade até 31/12/2026.
- PERFIL: a busca completa inicial com as três rodadas atingiu 25,68 segundos no GitHub Actions, sem o corte arbitrário das linhas. É mais completa, mas ainda precisa ser acelerada para uso mobile.
- PRECISÃO DE GPS: não se converte GPS de veículo em ETA individual sem vínculo confiável com `trip_id`.
- METRÔ: ainda sem tabela de viagens e sem feed verificável de trens; apenas sugestões não temporizadas.
- DATAS: se a data ultrapassar a validade do GTFS, recusa extrapolar horários.
- PLANEJAMENTO: todas as opções são projeções programadas; mesmo após validação não há garantia de não atrasar ou perder conexão no mundo real.
- TESTES: `py -3 -m unittest discover -s tests -v`. Benchmarks reais: workflow `test-routing-real.yml`. Não aprovar deploy somente com testes unitários: faltam testes de navegação mobile, precisão de trajetos pedestres, volume, concorrência e contraprova real contra a operação.

## Próximos desbloqueios

1. Reduzir latência sem descartar linhas ou alternativas úteis.
2. Serviço de ruas local real, inclusivo para travessias/entradas de estação.
3. Incorporar GTFS-RT pareado a `trip_id` quando a SUMOB fornecer identificadores compatíveis.
4. Dados metroviários de partidas efetivas antes de sugerir integrações ônibus + metrô como temporalmente válidas.
5. Atualização automática do GTFS e versionamento transacional do catálogo em produção.

## Otimização posterior ao perfil

- Catálogo no formato JSON array comprimido por linha (schema 3), com uma decodificação por arquivo, em vez de centenas de milhares de decodificações por viagem.
- Cache de vizinhança de pontos para evitar repetir milhões de cálculos geográficos.
- Avaliação de dominância antes de construir etapas completas e formatar datas, evitando milhões de conversões desnecessárias.
- Truncamento de fronteiras Pareto explicitamente marcado como `status: partial`, em vez de indicar resultado comprovadamente ótimo.
- Os ganhos de desempenho só são considerados confirmados após o benchmark com o índice schema 3 instalado; consultar logs do workflow.
