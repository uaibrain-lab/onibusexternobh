# Externo BH — Integração única de ônibus, metrô, GPS e rotas

**Estado:** branch isolada de integração; **sem deploy e sem merge em `main` ou alteração no Hub UFMG**.

Esta versão reúne a experiência de quatro abas: **Pontos, Linhas, Metrô e Rotas**. O motor de planejamento GTFS com caminhada por OSM real opera no navegador na versão estática gratuita. Os pontos agora têm horários de tabela por **sentido e destino**, calculados com 256 pequenos arquivos GTFS carregados por demanda. Favoritos, compartilhamento de ponto, agrupamento no mapa e painel mobile vêm da linha de desenvolvimento P14.

- **Modo estático gratuito:** `py -3 scripts/build_static_site.py`; depois `py -3 -m http.server 8765 --directory dist` e abrir `http://127.0.0.1:8765/externo/`. **Sem GPS ao vivo**, identificado na interface.
- **Modo local com GPS PBH:** `py -3 server.py --port 8765`, abrindo `http://127.0.0.1:8765/externo/`. GPS/ETA conservador disponível apenas quando a fonte responder; não é um serviço hospedado no Spark.
- **Integração ao Hub:** ainda **não realizada**. Este projeto preserva o prefixo `/externo/` e seus recursos para integração posterior sem dependência de Blaze, VPS ou API paga.

**Status de QA:** validação de sintaxe JS e testes isolados de estimativas/destinos feitos; o GitHub Actions ainda não iniciou os jobs completos nesta rodada e não há homologação Android física. Não classificar como versão de produção.

Detalhes, cronograma e riscos: [docs/INTEGRACAO-UNICA-20261117.md](docs/INTEGRACAO-UNICA-20261117.md).

**P18 — 17/11/2026:** o usuário confirmou que o ambiente independente
https://externo-bh-hml-uaibrain.pages.dev/externo/ está online.
A auditoria HTTP do Pages publicado foi adicionada em
[docs/P18-AUDITORIA-PAGES-PUBLICADO.md](docs/P18-AUDITORIA-PAGES-PUBLICADO.md).
Execute `node scripts/check_p18_public_site.mjs` no Windows antes de
considerar a publicação validada; a análise visual mobile continua pendente.
O GPS padrão no repositório permanece desativado e o Hub não foi alterado.

**P23 — 17/11/2026:** pesquisa das APIs públicas Google Maps/Moovit e
da arquitetura aberta OpenTripPlanner. Motor CSA no navegador aprimorado:
caminhada OSM de acesso e saída antes do scan GTFS (Dijkstra em lote),
busca ampliada de baldeações a pé, opção Equilibrada com custo heurístico,
filtro Pareto após validação da rua e avisos de baldeação apertada.
Diagnóstico LOCAL sem APIs pagas com foco nas combinações 9209+5106,
9106+5106 e 9106+51. Revisão PWA de homologação. Os pesos e algoritmos
proprietários de Moovit/Google NÃO são conhecidos; não alegar igualdade
de resultados. Documentação e fontes:
[docs/P23-PESQUISA-ALGORITMOS-ROTAS.md](docs/P23-PESQUISA-ALGORITMOS-ROTAS.md).
**P23 não publicada**, suíte completa e comparação com coordenadas reais
pendentes; Hub UFMG/Firebase intactos.

**P22 — 17/11/2026:** complementos da P21: toque em parada mantém
rastreamento; consultas de horários exigem sentido/headsings GTFS
coerentes e ignoram respostas antigas; separação do tempo planejado
entre caminhada, ônibus e espera; busca de endereço responsiva e com
coordenadas dentro da área do roteador; suite de regressão maior;
redução da duplicidade de Actions. O site de homologação **ainda não foi
atualizado** com essas alterações. Consulte
[docs/P22-ROBUSTEZ-LINHAS-HORARIOS-ROTEAMENTO.md](docs/P22-ROBUSTEZ-LINHAS-HORARIOS-ROTEAMENTO.md).
Execuções do Actions falham antes de expor etapas de teste; CI pendente.

**P21 — 17/11/2026:** modo de linha temporário com retorno ao mapa e
ponto anteriores; paradas restritas ao percurso selecionado; seletor de
ponto com horários GTFS; busca explícita por endereço/estabelecimento
via Photon/OSM, com fallback local; planejador agora considera mais
pontos de acesso, caminhadas entre paradas e itinerários distintos.
O usuário identificou diferença em relação ao Moovit
(9209+5106 36 min versus resultados GTFS mais lentos); tempos exatos
ainda não homologados com as mesmas coordenadas e calendário.
Consulte [P21](docs/P21-LINHAS-LOCAIS-ROTEAMENTO.md).
**Não publicado no Pages; PR draft, Hub intacto.**

## P17 — Site de homologação GPS oficial SUMOB, sem custos obrigatórios

O GPS GTFS Realtime SUMOB foi validado no Worker gratuito com HTTP 200,
1.779 veículos no feed e 7 posições da linha 5102. A amostra Cloudflare
de 23 invocações (múltiplas versões) registrou CPU P99 de 7,15 ms, sem
excessos, mas ainda não comprova capacidade em escala.

- **Build normal permanece sem GPS:** `python scripts/build_static_site.py`.
- **Build exclusivo de homologação com GPS:** 
  `python scripts/build_static_site.py --gps-staging`.
  A configuração `static/gps-config.json` permanece `enabled:false`
  no GitHub e no build normal. Só o pacote de homologação liga o GPS.
- **Primeira publicação isolada opcional:** script
  `scripts/Publicar-GPS-Homologacao.ps1` (PowerShell 5.1) com flags
  explícitas de criação de projeto Pages e atualização do Worker CORS.
  **Não cria nem modifica Firebase ou ru-hoje.**
- **Destino planejado, ainda não publicado:**
  `https://externo-bh-hml-uaibrain.pages.dev/externo/`.
- **Teste de build e segurança:** 
  `python -m unittest discover -s tests -p test_gps_staging_build.py -v`.
- **Teste de GPS isolado:** 
  `node --test tests/test_gtfs_realtime_worker.cjs tests/test_gtfs_realtime_adapter.cjs tests/test_live_gps_adapter.cjs`.

Leia [docs/P17-HOMOLOGACAO-PAGES-GPS.md](docs/P17-HOMOLOGACAO-PAGES-GPS.md)
antes de publicar. Nenhuma previsão GPS (ETA) é alegada como confiável,
nem há banco ou backend pago. Homologação Android e uso contínuo
ainda pendentes.

---

# P9 — Quatro abas em hospedagem estática, ruas OSM e metrô com incerteza

**Entrega em desenvolvimento; nenhum deploy em produção.** As abas **Pontos, Linhas, Metrô e Rotas** foram conectadas a catálogos públicos GTFS para hospedagem grátis. Os veículos ao vivo ainda não estão disponíveis na versão estática, e a interface mostra essa limitação em vez de inventar posições GPS.

A P9 já contém um grafo real do OpenStreetMap para a região de BH (**412.312 nós, 456.495 conexões**), utilizado pelo cálculo A* no próprio navegador. Os deslocamentos a pé seguem vias mapeadas, mas a ligação entre ponto/endereço e calçada, acessibilidade e segurança ainda precisam de homologação física.

O metrô mostra janelas **históricas e estimadas**, não horários exatos ou ETA ao vivo. A Linha 2 e os trechos sem referências oficiais não recebem tempos inventados. A integração exata ônibus↔metrô permanece pendente por falta de horários ferroviários verificáveis.

**Desempenho:** GTFS gratuito por arquivo estático; busca normal ou ampliada (mais lenta), com avisos de resultados parciais. Regressão: 51 testes Python, 22 JS (antes do teste adicional da busca ampliada) e 6 E2E desktop/Android emulado aprovados. Aparelhos físicos e operação de campo não foram testados.

**Detalhes e próximos passos:** [Roteamento P9](docs/ROTEAMENTO-P9-MULTIMODAL.md).

---

# P8 — Mais precisão com roteamento gratuito no navegador

**Fase de desenvolvimento, sem deploy.** O planejador do Ônibus Externo BH agora carrega apenas as conexões GTFS dos grupos de calendário necessários à data consultada, trata viagens acima de 24h, respeita a margem inicial de embarque nas buscas de chegada e rejeita blocos incompletos.

**Redução verificada de dados:** 18,35 → **4,13 MB** na consulta de partida e 13,69 → **3,48 MB** na busca reversa subsequente. O processamento continua no navegador e não exige Firebase Blaze/Cloud Functions nem VPS. Uma cache opcional guarda no máximo 16 blocos horários consultados.

**Fonte e automação:** SHA-256 do GTFS oficial, validação e workflow que prepara a atualização sempre que a fonte mudar; a agenda GitHub só fica ativa após a integração à branch padrão, e **não publica no Firebase** nesta fase. O GTFS atual expira em 31/12/2026.

**Ainda não está pronto para lançamento público:** resultados podem ser parciais, caminhadas não seguem a rede de ruas verificada, metrô sem horários de partidas integrados e telas antigas de ônibus dependentes de Python não migradas.

Documentação e homologação: [P8 — Roteamento com custo zero](docs/ROTEAMENTO-P8-CUSTO-ZERO.md).

---

# P7 — Roteamento gratuito no navegador (17/11/2026)

**O planejador de ônibus agora roda no navegador, sem servidor pago.** O catálogo GTFS oficial é convertido pelo GitHub Actions em arquivos estáticos horários comprimidos. As viagens são calculadas por um Web Worker, com saída programada ou chegada planejada, até duas baldeações, respeito às restrições oficiais de embarque/desembarque e alternativas por tempo, caminhada e transferências.

**Hospedagem prevista:** Firebase Hosting Spark (sem Cloud Functions/Blaze), sujeita à franquia gratuita de 10 GB/mês de transferência. **Nenhuma publicação de produção foi realizada.**

**Preview estático:** `py -3 scripts/build_static_site.py`, depois `py -3 -m http.server 8765 --directory dist`; abrir `http://127.0.0.1:8765/externo/`. O preview estático exibe **Rotas e Metrô**, não as telas P2/P3 de consulta GPS que continuam dependentes do backend anterior.

**Resultado testado:** 6.577.312 conexões, seis alternativas reais nos trajetos de referência, 5,43 s para partida e 3,05 s para chegada, medidos em runner GitHub sem latência de internet. Os resultados ainda sinalizam `partial` quando há poda de rótulos. Caminhadas não usam rede de pedestres validada, e metrô não participa de horários calculados.

**Detalhes e limites:** [Roteamento P7 — Hospedagem Gratuita](docs/ROTEAMENTO-P7-HOSPEDAGEM-GRATUITA.md).

---

# Externo — Hub UFMG · P5 (planejador de viagens, protótipo)

**P5 em desenvolvimento; sem deploy.** Nova aba **Rotas**, com origem/destino por mapa, GPS ou endereço, horários de partida/chegada, comparação de itinerários reais do GTFS e transferências. Possibilidades com metrô são apenas indicativas até existir programação metroviária verificável.

**Gerar o índice de viagens**: executar o workflow de `build-routing.yml` ou `py -3 scripts\\build_routing.py GTFSBHTRANS.zip catalog`. O protótipo não calcula ônibus se `catalog/routing-index.json` estiver ausente; não inventa rotas a partir de horários agregados.

**Precisão**: partidas dos ônibus conforme tabelas GTFS, não ETA GPS; caminhada por distância aproximada, não pela rede de pedestres. Não está homologado como Moovit. [Documentação P5](docs/PLANEJADOR-P5.md).

---

# Externo — Hub UFMG · P4 (metrô integrado)

**Branch de desenvolvimento, sem deploy de produção (17/11/2026).** A P4 acrescenta a aba **Metrô** à P3 e mantém as funcionalidades de ônibus existentes. O código desta branch **não altera** a `main` nem o Hub publicado.

**O que foi integrado:** 22 estações cadastradas em operação (Linha 1 até Novo Eldorado e Linha 2 Nova Suíça–Amazonas), seleção e busca no mapa, linhas esquemáticas, intervalos e horário habitual da operadora, avisos excepcionais, links oficiais de previsão por estação, RSS de comunicados e pontos de ônibus próximos. **Sem previsão própria de trem em tempo real**: frequência não é ETA.

**Documentação e limites:** [docs/METRO-P4.md](docs/METRO-P4.md). API: `/externo/api/metro`, `/externo/api/metro/line?id=1`, `/externo/api/metro/station?id=amazonas`, `/externo/api/metro/nearby?lat=-19.93&lng=-43.98` e `/externo/api/metro/news`.

---

# Externo — Hub UFMG · P3 (protótipo de homologação)

Versão: **P3 RC1**, 17/11/2026. **Sem deploy de produção.** Aplicação independente, preparada para ser incorporada futuramente como `/externo/` no Hub UFMG. Visual inspirado diretamente no `public/interno/index.html` do repositório `uaibrain-lab/ru-hoje`.

## Funcionalidades

- Abertura no **campus UFMG** (`-19.8695, -43.9675`, zoom 15), sem selecionar linha padrão; pontos do GTFS aparecem no mapa como marcadores clicáveis.
- Autorização opcional para localização por ação do usuário, com alternativa sem permissão e listagem dos pontos próximos ordenados por distância.
- Busca dos **9.925 pontos** e consulta das **326 linhas** na versão do GTFS `202611161919`.
- Painel de ponto com todas as linhas que passam nele, destino e **próximo horário programado** de passagem (até cinco horas) com minuto e horário. **Não é ETA ajustado por GPS**: não promete que o veículo esteja a caminho. Se não há horários válidos, mostra `Sem previsão`.
- Favoritos de pontos e linhas salvos em `localStorage` (deste navegador). O sistema não exige login.
- Interface responsiva no padrão Interno: mapa de tela inteira; painel inferior expansível no celular, lateral no desktop; temas claro e escuro; navegação Pontos/Linhas.
- Quando o usuário seleciona uma linha, o P2 continua exibindo frota GPS e trajetos do GTFS. A regra de `positionUnchangedSinceAt`, `lastGpsFixAt`, `lastFetchedAt` **permanece vigente**, inclusive após reiniciar o servidor.

## Importante sobre privacidade e precisão

- A permissão de localização não é obrigatória nem solicitada automaticamente em segundo plano: a tela explica a finalidade e o navegador pede consentimento ao clicar em **Usar minha localização**.
- Para calcular distâncias, o navegador envia lat/lng ao **servidor do próprio rastreador**, que não salva esses valores. O logger foi modificado para não registrar parâmetros de URL. A localização de cada pessoa não é enviada à PBH.
- No site publicado, geolocalização exige HTTPS (ou `localhost`) e, se inserida por iframe, `allow="geolocation"`.
- Os horários GTFS são horários **de tabela**, não uma confirmação de que o ônibus está circulando. Para ETA real, ainda será necessário validar uma fonte de previsão dinâmica (GTFS-RT Trip Updates ou estimativa GPS com sentido confirmado).
- O timetable é válido somente para as datas documentadas pela versão do GTFS. As previsões não são extrapoladas para além da validade da base (31/12/2026 nesta versão).

## Executar no Windows (PowerShell 5.1)

Após extrair o ZIP em `D:\Downloads\BH-Rastreador-P3`, rode:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Downloads\BH-Rastreador-P3\INICIAR-WINDOWS.ps1"
```

Abra `http://127.0.0.1:8765/externo/`. Requer **Python 3.9+**, sem `pip`, npm ou serviços pagos. O servidor atende apenas `127.0.0.1`; não publica nada na internet. O mapa-base usa tiles de OpenStreetMap e pode não renderizar quando não há acesso à internet; os pontos e traçados continuam disponíveis no canvas.

### Rotas de API locais

- `/externo/api/map-stops?minlat=-19.88&minlng=-43.98&maxlat=-19.86&maxlng=-43.95` — paradas visíveis no mapa (limite de 550 por quadro).
- `/externo/api/nearby-stops?lat=-19.8695&lng=-43.9675` — paradas próximas, ordenadas por distância.
- `/externo/api/stop?id=14791407` — todas as linhas e próximo horário GTFS programado da parada.
- `/externo/api/routes`, `/externo/api/route?code=9202`, `/externo/api/fleet?route=9202` e `/externo/api/status` — funções anteriores P2.

### Regerar o calendário de horários

Com um novo arquivo GTFS da PBH:

```powershell
py -3 scripts\build_timetable.py "D:\Downloads\GTFSBHTRANS.zip"
```

O comando recria `catalog/timetable.json.gz` e `catalog/timetable-calendar.json`. **Não altera a produção**. O índice compactado da versão atual tem cerca de 17 MiB (6.691.004 registros de stop_times). É carregado sob demanda na primeira consulta de horários, e não no primeiro desenho do mapa.

### Testes

```powershell
py -3 -m unittest discover -s tests -v
```

**16 testes automatizados** passaram neste pacote, cobrindo P2 GPS e P3 catálogo, localização, ETA programado e expirado. A UI desktop/mobile também foi exercitada com mocks; falta homologação visual e GPS real no Windows.

### Enviar P3 para GitHub sem modificar a main

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Downloads\BH-Rastreador-P3\PUBLICAR-P3-GITHUB-WINDOWS.ps1"
```

O script usa a branch P2 já publicada como base, cria/atualiza `feat/externo-hub-p3-pontos-eta`, executa os testes e publica as alterações. A `main` e o site do Hub não são alterados.

## Limitações antes de integrar ao Hub

1. A versão corrente é um **servidor Python local**, não executável pelo Firebase Hosting Spark estático sem backend.
2. Favoritos são locais por navegador e não sincronizam entre dispositivos.
3. Não há ETA ajustado por GPS nem confirmação automática de qual variante o ônibus seguirá; isso deve ser acrescentado somente quando houver evidência confiável.
4. A base de horários precisa de rotina automática de renovação, verificação de integridade e rollback antes de produção.
5. Antes de colocar em produção, rever limites/licenças dos feeds PBH e a política de uso de tiles do OSM.
6. Geolocalização foi testada com navegador simulado; homologar o fluxo real de permissão no Windows e no Android.

Dados: Prefeitura de Belo Horizonte / SUMOB / Mobilibus, conforme catálogos oficiais. Mapa: © OpenStreetMap contributors.
