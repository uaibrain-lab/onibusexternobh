# P18 — Auditoria pública da homologação Cloudflare Pages

**17/11/2026. Repositório autorizado:** uaibrain-lab/onibusexternobh.
**URL confirmada online pelo usuário:** https://externo-bh-hml-uaibrain.pages.dev/externo/

A publicação continua separada de ru-hoje, Firebase e Hub UFMG. Não houve
novo deploy por parte do assistente ao preparar esta auditoria.

## Evidências prévias

- A SUMOB GTFS-RT respondeu HTTP 200 ao Worker: 1.779 registros e 7
  posições da linha 5102 no teste anterior.
- Amostra de métricas Cloudflare de 23 invocações agregadas:
  CPU P50 de 0,71 ms, P99 de 7,15 ms, sem limites excedidos.
  Amostra insuficiente para garantia de disponibilidade sob carga.
- Build local de homologação passou com 18 testes JS, 4 Python, 496
  arquivos e 141 MiB.
- GPS permanece DESATIVADO no arquivo estático padrão do GitHub e ativado
  somente no pacote Pages criado com --gps-staging.
- Navegação remota do assistente não conseguiu recuperar o site; isso
  NÃO demonstra indisponibilidade, nem é teste visual do ambiente publicado.

## Auditoria real de leitura (sem deploy)

Execute no Windows PowerShell:

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
node --test tests/test_p18_public_audit.cjs
node scripts/check_p18_public_site.mjs
~~~

O verificador faz somente GETs pontuais, sem loops de carga, não transmite
localização pessoal nem imprime IDs/latitudes de veículos. Verifica:

- HTML público, marcação de homologação, noindex e arquivos JS essenciais.
- JSON GPS habilitado apenas no site de teste, com cache no-store.
- Arquivo-fonte static/gps-config.json ainda desativado.
- Presença da linha 5102 no catálogo, edição coerente de GTFS e validade,
  inclusive datas no formato AAAAMMDD (por exemplo, 20261231).
- Catálogo de chegadas, service worker e outros arquivos essenciais.
- Versão de capacidades do Worker, CORS com origem Pages exata.
- UMA consulta GPS ao vivo SUMOB, código público 5102, posições recentes,
  ausência de ETA inventado e quantidade de registros.
- Zero observações GPS NÃO significa zero ônibus em circulação.

Resultado esperado: P18_PUBLIC_AUDIT_OK.
Em caso de falha, apresentar todo o JSON, principalmente os arrays
failed e checks e os dados de details.gps.

## Homologação visual de Android e PC

Na URL publicada, abrir a aba Linhas e consultar 5102; confirmar a marca
TESTE, posições na lista e no mapa, fonte SUMOB e GPS sem ETA fictício.
Também conferir largura 360/390px, abas Pontos/Metrô/Rotas, orientação,
comportamento offline e ausência de atualizações em aba oculta.
Os horários de tabela continuam sendo fallback quando o GPS falha.

Não afirmar que GPS confirma o sentido/variante de cada veículo sem
correspondência ao trajeto comprovada. Não mesclar em main ou publicar
no Hub sem nova autorização explícita. Manter sempre infra Free.
