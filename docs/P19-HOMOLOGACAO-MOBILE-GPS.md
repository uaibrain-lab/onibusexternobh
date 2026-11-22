# P19 — Homologação mobile do Externo BH com GPS oficial SUMOB

**Status 17/11/2026:** o usuário executou a auditoria P18 na URL
https://externo-bh-hml-uaibrain.pages.dev/externo/ e confirmou
P18_PUBLIC_AUDIT_OK. O código-fonte mantém GPS desligado por padrão,
o Pages de homologação é separado e ru-hoje/Firebase continuam intactos.

## O que P18 demonstra

A auditoria P18 passou para arquivos publicados, configuração GPS,
CORS estrito, GTFS, linha 5102, chegadas programadas e resposta
SUMOB recente sem ETA inventado. A P18 não comprova responsividade,
desenho do mapa, sentido de cada veículo nem uso contínuo em Android.

## Aceitação no Android real

Acesse https://externo-bh-hml-uaibrain.pages.dev/externo/:

1. Confira a etiqueta TESTE. Abra Linhas, consulte 5102.
   Observe posições recentes na lista e no mapa, se disponíveis.
   Zero posições observadas NÃO significa zero ônibus circulando.
2. Troque pelas abas Pontos, Linhas, Metrô e Rotas. Verifique
   se o painel não causa rolagem horizontal ou botões cortados.
3. Teste sem permissão de localização (mapa perto da UFMG) e
   com permissão (pontos próximos, localização não enviada ao Worker).
4. Deixe o site em segundo plano por cerca de dois minutos e volte.
   O app não deve consultar continuamente o GPS enquanto oculto.
5. Sem internet ou com falha na SUMOB, os horários programados
   continuam disponíveis quando os índices já foram baixados.
6. Envie capturas da aba Linhas com 5102 e da aba Pontos,
   informando eventuais problemas de mapa e atualização.

Não inferir ETA nem sentido exato com base apenas nas coordenadas.

## Auditoria opcional de navegador emulado

Foi acrescentado teste real separado do CI normal:
- tests/live-p19-stage.cjs
- tests/playwright-p19.config.cjs

Ele faz apenas uma seleção da linha 5102 por dispositivo,
consulta o Worker real e grava um relatório de interface e GPS.
Não simula carga, não altera dados nem obtém localização privada.

Se Playwright já estiver instalado, execute no PowerShell:

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
npx.cmd playwright test --config=tests/playwright-p19.config.cjs --project=android-390-emulado
~~~

Não é obrigatório instalar Playwright para fazer a homologação
manual em aparelho real. Para testar também 360 px e desktop,
pode executar sem o argumento --project, lembrando que cada
browser consulta o GPS oficial uma vez.

## Travas antes de integrar ao Hub

- Mobile real e experiência de leitura e interação aprovadas.
- Nenhuma inferência falsa de movimento/ETA/sentido.
- Métricas Cloudflare Workers Free monitoradas com tráfego real.
- Catálogo GTFS vigente para a data consultada.
- Sem merge em main, ru-hoje ou Firebase sem autorização explícita.

Não é necessário fazer outro deploy do Pages para testar a P19.
