# P24 — Rotas metropolitanas, pontos candidatos e geocodificação

Data: 17/11/2026. Repositório: uaibrain-lab/onibusexternobh.
Branch: feat/gps-worker-free-homologacao-p15-20261117. PR #19 draft.
P24 ainda NÃO foi publicada; Hub UFMG, ru-hoje e Firebase intactos.

## Problema real comunicado pelo usuário

Externo BH a partir de 22:03:
- 9211 + S84 + 52: 60 min, 1654 m de caminhada;
- 9209 + 1509 + 5250: 73 min;
- 9211 + 5250: 73 min;
- 9209 + 8107 + 5106: 84 min;
- 9209 + 5106: 84 min;
- 9209 + 8251 + 5250: 92 min.

Moovit na comparação informada:
- 9209 + 411C: aproximadamente 43 min;
- 9405 + 411C: aproximadamente 47 min;
- 9106 + 411C: aproximadamente 41 min;
- 9106 + 51: aproximadamente 51 min.

O usuário percebeu resultados limitados à parada mais próxima e
indisponibilidade persistente da busca por endereços/comércios.

## Causa 1: 411C metropolitana ausente do índice municipal

catalog/routes.json da branch contém 9106, 9209 e 51, mas NÃO 411C.
A linha 411C é metropolitana (São Benedito/BH), sob SEINFRA/DER-MG.
As combinações com 411C não podem ser calculadas com GTFS municipal.

Fontes:
- https://ckan.pbh.gov.br/dataset/gtfs (PBH/SUMOB municipal)
- https://der.mg.gov.br/institucional/sobre-o-deer-mg/organograma/13-servicos/1311-obter-informacoes-sobre-transporte-coletivo-metropolitano
- https://www.consultas.der.mg.gov.br/grgx/sgtm/acesso_informacao.xhtml
  (documentação de arquivos quadro_horario_rmbh.txt e itinerario_rmbh.txt)
- https://moovitapp.com/index/pt-br/transporte_p%C3%BAblico-time-411c-Belo_Horizonte-843-858226-149565882-7070843-0

Integração futura P25: obter arquivos DER atuais, validar linha,
sentido, ponto, coordenadas e horários de passagem, depois unificar
somente as conexões verificáveis. Partidas do terminal sozinhas NÃO
indicam tempo de passagem em cada parada; não inventar interpolação,
GPS ou chegada.

O motor agora declara coverage.metropolitanBh=false, e a interface
alerta que esses itinerários NÃO estão incluídos.

## Causa 2: muitos pontos de um corredor descartavam outros acessos

Antes, os 48 pontos mais próximos (Normal) ou 80 (Ampliada) eram
pré-selecionados por distância em linha reta, antes do grafo viário.
Em áreas densas, isso preenchia todas as vagas com a mesma avenida.

P24 agora preserva os mais próximos E distribui os demais por 16
direções e 3 faixas de distância. Limite: 120 Normal (raio 1,3 km),
160 Ampliada (raio 1,7 km). Todos os candidatos continuam sujeitos
à validação de caminhos OSM, com limite de 160 no Dijkstra do P23.
Não alterar horários GTFS nem inventar serviço metropolitano.

Teste sintético já executado pelo assistente: 185 pontos de um
corredor e 24 de outros acessos. A lista Normal incluiu 23 de outros
corredores e manteve a parada mais próxima. Isso não garante
resultado real equivalente ao Moovit; exige benchmark com coordenadas
e hora iguais.

## Causa 3: dependência externa frágil (Photon)

O Photon público é demo sem garantia de disponibilidade; pode limitar
ou bloquear requisições. A versão anterior dependia do acesso direto
pelo navegador, sujeito também a restrições CORS.

Fontes:
- https://github.com/komoot/photon/blob/master/README.md
- https://github.com/komoot/photon/blob/master/docs/api-v1.md

P24 acrescenta /api/geocode no MESMO Cloudflare Worker Free:
- requisição só por clique explícito, com origem CORS autorizada;
- URL Photon fixa, nunca URL informada pelo usuário;
- máximo 130 caracteres de texto, área BH fixa, até 8 locais;
- cache por datacenter de 24 h, sem KV, D1, DB ou cobrança;
- respostas 429/503 visíveis e fallback para pontos locais/mapa;
- no Pages o navegador usa o Worker. Antes do deploy da nova versão,
  apenas HTTP 404 pode usar o acesso direto anterior.
- scripts/check_geocode_worker.mjs faz UMA consulta fixa a Belo
  Horizonte e exige sucesso de fato para permitir deploy do Pages.
  Não transmite latitude/longitude pessoal ao Worker ou Photon.

O script de publicação bloqueia release se testes ou verificação
real do geocoder falharem. Isso evita repetir o problema silencioso
da consulta externa sempre indisponível.

## Próximo passo técnico (Windows PowerShell 5.1)

Na pasta já clonada:

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117

# Validar e gerar build, sem deploy
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Publicar-GPS-Homologacao.ps1"

# Se passou: publicar apenas Worker e Pages de homologação
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Publicar-GPS-Homologacao.ps1" -ReutilizarBuild -AtualizarWorker -Publicar
~~~

NÃO usar -CriarProjeto: Pages já existe. NÃO fazer deploy do Hub,
Firebase ou branch main.

Novos testes P24:
- tests/test_p24_boarding_candidates.cjs
- tests/test_p24_geocode_client.cjs
- tests/test_p24_geocode_worker.cjs
- tests/test_p24_metropolitan_coverage.cjs

Pendente: rodar suíte completa Node e Python em Windows; testar de
verdade Photon via Worker; Playwright PC/Android, comparação exata
com Moovit, registro de métricas Workers Free. Os testes JS sintéticos
não garantem uptime do serviço Photon.

Próxima IA: registrar SHA, testes EXECUTADOS versus pendentes,
erros da fonte DER/Photon, trabalho metropolitano e estado real
da homologação. Nunca confundir commit com deploy.
