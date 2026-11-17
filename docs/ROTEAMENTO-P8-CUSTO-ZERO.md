# P8 — Precisão e atualização automática, mantendo custo zero

Branch: `feat/externo-p8-precisao-atualizacao-gratuita-20261117`.
Base: P7 (`feat/externo-p7-rotas-estaticas-gratuitas-20261117`).
**Não houve deploy para Firebase ou atualização da produção do Hub UFMG.**

## Melhorias implementadas

1. **Calendário GTFS segmentado:** o índice estático v2 separa as conexões por hora, sentido e máscara semanal de serviço. Dados de domingo ou sábado não precisam ser transferidos em uma consulta comum de dia útil. Serviços ativados exclusivamente por `calendar_dates` estão no grupo 0 e são carregados quando a exceção autoriza.
2. **Integridade das respostas:** cada bloco binário precisa corresponder à quantidade de conexões declarada no manifesto. Uma versão incompleta, antiga ou corrompida gera erro explícito, não um itinerário inventado.
3. **Chegar até:** a caminhada até o primeiro ponto inclui margem adicional de pelo menos 45 segundos antes do embarque, inclusive ao executar pesquisa reversa.
4. **Virada do dia:** regressão para GTFS `24:50` e `25:10`, preservando a data correta do serviço anterior.
5. **Interface sem resultados obsoletos:** alterações de origem, destino, horário ou preferência cancelam consultas pendentes e limpam os itinerários antigos.
6. **Cache opcional para uso repetido:** `static/service-worker.js` funciona apenas no caminho `/externo/` do preview estático. Guarda até 16 arquivos horários já acessados; não baixa o catálogo inteiro, não interceta outros sites nem transforma erros de quota de armazenamento em indisponibilidade da consulta online.
7. **Fonte oficial validada:** `scripts/check_official_gtfs.py` compara SHA-256, verifica arquivos obrigatórios, limites de ZIP, duração do calendário e protege o catálogo anterior se a origem estiver vencida/inválida.
8. **Renovação preparada:** `.github/workflows/free-gtfs-refresh.yml` verifica o GTFS, só reconstrói os índices quando o SHA muda, executa testes e empacotamento antes de gravar os dados na branch. **A agenda só é executada automaticamente na branch padrão do GitHub depois da integração autorizada. Não faz deploy.**

## Números verificados no GitHub Actions

Fonte GTFS: `https://s3.amazonaws.com/mobilibus-uploads/gtfs/GTFSBHTRANS.zip`.
Checksum verificado em 17/11/2026:
`ef448448ac0aa89877e33a34645acaac34a5bb45d9a849e2c5b92cdc238366b1`.

- **113.692 viagens**, **9.925 paradas**, **6.577.312 conexões**, distribuídas em 4 grupos de calendário (`0`, `31`, `32` e `64`).
- **Validade do GTFS consultado: 31/12/2026.**
- Tamanho total de todos os arquivos estáticos comprimidos de horários: **115.010.124 bytes (aproximadamente 109,68 MiB)**. Eles não são todos baixados pelo navegador.
- P7 no mesmo trajeto UFMG/Centro: **18,35 MB** de arquivos lidos para a partida; P8: **4,13 MB**. Redução próxima de **77%**.
- P7 na busca reversa subsequente: **13,69 MB** adicionais; P8: **3,48 MB**. Redução próxima de **75%**.
- Tempo varia por runner: P8 partida **4,94–7,54 segundos** e chegada **2,82–3,00 segundos** em benchmarks de GitHub Actions. **Não são tempos garantidos no celular**, pois a conexão e hardware influenciam.
- Testes: **49 testes Python** no workflow de renovação; **10 testes JS** após a inclusão dos cenários de exceção de calendário e virada da meia-noite. Novas versões devem continuar passando em CI.

## Como usar gratuitamente

O site estático não usa Cloud Functions, Firebase Blaze, VPS, APIs comerciais nem serviço de geocodificação pago. O cálculo ocorre no dispositivo e os arquivos são servidos pelo Firebase Hosting Spark em caso de publicação autorizada, **sujeito às franquias gratuitas**.

Código:
`scripts/build_routing.py` → `scripts/build_static_scan.py` → `scripts/build_static_site.py`.

Execução local:

```powershell
py -3 -m unittest discover -s tests -v
node --test tests/test_static_worker.cjs
node tests/benchmark_static_worker.cjs
py -3 scripts\build_static_site.py
py -3 -m http.server 8765 --directory dist
```

Abra `http://127.0.0.1:8765/externo/`.

O pacote da preview permanece sem deploy. O cache é apenas um auxílio: uma primeira consulta ainda precisa de rede, e usar a aplicação 100% offline requer ter os arquivos específicos da consulta no armazenamento local.

## Limitações e pendências para lançamento público

- **Busca parcial:** limites de rótulos para manter o processamento viável continuam impedindo garantia de melhor itinerário global. O sistema sinaliza `partial` e não afirma otimalidade comprovada.
- **Caminhada:** ainda é estimada pela distância geométrica; não existem trajetos reais georreferenciados pela rede caminhável no preview P8. Não prometer acessibilidade, travessia ou segurança.
- **Metrô:** estações e avisos disponíveis, mas sem grade de partidas dos trens verificável. Sugestões não são itinerários temporizados ônibus+metrô.
- **Tempo real:** GPS de ônibus sem associação confiável a `trip_id` não é usado para afirmar a chegada da viagem.
- **Telas P2/P3:** as funcionalidades de ônibus/linhas ainda dependentes de Python são ocultadas exclusivamente no preview estático. É necessário migrá-las antes de integrar o site definitivo.
- **Operação contínua:** a atualização diária programada só funcionará quando o workflow for colocado na branch padrão e tiver permissões de escrita. Ela ainda não publica a versão regenerada no Firebase; a integração de deploy precisa de autorização explícita.
- **Franquias:** o limite gratuito de tráfego do Hosting e as cotas de GitHub Actions não são ilimitados. Caches melhoram o uso, mas nenhuma arquitetura pode garantir gratuidade indefinida em qualquer volume.
- **Crescimento do Git:** manter cada versão de 110+ MiB no histórico do GitHub aumentará o tamanho do repositório. Antes de ativar atualizações frequentes em produção, avaliar armazenamento do artefato de publicação em vez de acumular blobs em Git indefinidamente.
- **Mobile/produção:** validar comportamento em aparelhos Android, desempenho em rede móvel, quotas, regressões de UI e tráfego na integração ao Hub antes de disponibilizar ao público.

## Segurança de publicação

Os workflows implementados em P8 operam apenas no GitHub, com dados oficiais públicos. **Não há comando de deploy, alteração de regras Firebase ou habilitação de serviços pagos.** A branch continua sob revisão e pode ser homologada antes de qualquer integração.
