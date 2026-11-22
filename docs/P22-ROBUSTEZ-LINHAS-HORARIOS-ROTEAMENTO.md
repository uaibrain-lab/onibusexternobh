# P22 — Robustez do acompanhamento, sentidos, buscas e tempos

**Data:** 17/11/2026, Belo Horizonte.
**Repositório:** uaibrain-lab/onibusexternobh.
**Branch:** feat/gps-worker-free-homologacao-p15-20261117, PR #19 draft.
**Produção e Hub UFMG:** intactos; P22 não publicado.

## Requisitos originais

Mostrar apenas as paradas do percurso ao acompanhar uma linha; restaurar
ponto e mapa anteriores ao fechar ou mudar de aba; escolher ponto manual
ou aproximar do usuário quando a localização já tiver sido autorizada;
pesquisar endereço, número e estabelecimento como origem/destino; melhorar
o ranking da viagem. Comparação reportada: Moovit mostrou 9209+5106
36 min, 9106+5106 39 min e 9106+51 45 min, enquanto a busca anterior
mostrava outras combinações e 9106+5106 em 66 min.

Não foram fornecidas nesta mensagem as coordenadas finais exatas de
origem/destino nem condições do Moovit, impedindo conclusão sobre esses
tempos; não calibrar o motor artificialmente para igualá-los.

## P22: alterações efetuadas

1. Tocar em uma parada desenhada DO PERCURSO enquanto o rastreio está
   ativo seleciona o ponto de embarque nessa mesma linha. Não fecha a
   linha nem navega indevidamente para o ponto geral.
2. Respostas assíncronas de traçados são ignoradas quando o usuário
   já fechou a linha ou escolheu outra seleção.
3. O próximo horário programado no ponto precisa corresponder ao
   headsign/destino do percurso selecionado. Uma linha com sentidos
   opostos no mesmo ponto NÃO pode mostrar o horário do outro sentido.
   Destino desconhecido com mais de um sentido é considerado ambíguo.
   Respostas antigas não sobrescrevem resultados após troca de padrão.
4. O roteador separa tempo total em caminhada, viagem a bordo e
   espera de tabela quando os horários das pernas são coerentes.
   Inconsistências de tempo fazem o detalhamento ser omitido; nenhum
   ETA GPS é inventado. Na visualização, a explicação aparece apenas
   no itinerário expandido para manter os cards enxutos.
5. A mensagem de busca parcial informa limites de cálculo do aparelho.
6. Photon/OSM restringe sugestões à mesma área aceita pelo roteador;
   usa texto informado somente após clique, sem enviar localização.
   Pontos GTFS locais aparecem logo; endereço externo é incorporado
   quando a API responde, com cache/rate limit e fallback para mapa.
   Editar o texto invalida respostas antigas do serviço.
7. O índice GTFS pesado continua sob demanda; pesquisar um ponto
   não inicia o motor de roteamento.
8. O build Pages de homologação recebeu revisão de cache P22.
   O script PowerShell bloqueia deploy caso falhem testes do mapa,
   da direção, do roteamento, do grafo OSM e do catálogo.
9. Workflows de testes passam a cancelar execuções anteriores do mesmo
   ramo, reduzindo redundância e consumo de minutos gratuitos.

## Evidências de testes realmente executados

- Avaliação isolada V8: sintaxe dos principais arquivos JS e testes
  adicionados OK.
- Simulação de retorno da linha: restaura centro, zoom e ponto anterior.
- Simulação do ranking: preservou uma alternativa 9106+5106 mesmo com
  dezenas de partidas da combinação 9106+9502.
- Simulação Photon: endereço, bounding box e cache, sem enviar GPS.
- Simulação temporal: viagem de 39 min distribuída em 13 min a pé,
  19 min dentro de ônibus e 7 min de espera. Não representa o Moovit.
- Simulação de sentidos da linha 5102: selecionou 8 min para Santo
  Antônio e rejeitou 1 min para UFMG. Não representa previsão real.

**PENDENTES:** suíte completa Node, unittest Python, Playwright PC/Android,
teste Android físico, comparação real com mesma origem/destino/horário,
monitoramento de CPU sob uso natural. Workflows Actions da branch terminam
em 2–3 segundos sem etapas disponíveis; logs não puderam ser recuperados.
Isso não autoriza concluir que os testes de código falharam ou passaram.

## Comando para validar e publicar SOMENTE homologação Pages

No PowerShell do Windows:

~~~powershell
cd D:\Downloads\Externo-GPS-Teste
git pull --ff-only origin feat/gps-worker-free-homologacao-p15-20261117
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Publicar-GPS-Homologacao.ps1" -Publicar
~~~

Esse script executa testes, gera build NOVO e publica só no projeto
externo-bh-hml-uaibrain (Cloudflare Pages Free). Se qualquer teste
falhar, não faz deploy. Para apenas testar, omita -Publicar.

Não usar -ReutilizarBuild, -CriarProjeto ou -AtualizarWorker nesta etapa.
Nunca publicar no ru-hoje, Firebase, branch main ou plano pago sem
autorização explícita.

## Critérios de aceitação reais após homologação

- Ao abrir uma linha: somente paradas do trajeto selecionado.
- Tocar em parada: seleciona ponto SEM fechar a linha.
- Próxima passagem no ponto respeita sentido e GTFS, nunca ETA falso.
- Fechar linha ou mudar de aba restaura ponto e mapa anteriores.
- Endereços e comércios pesquisáveis, com fallback offline e sem
  download desnecessário do motor.
- Resultados reais 9106+5106 e 9209+5106 comparados às mesmas
  coordenadas, calendário e janela do outro planejador.
- Sem sobreposição em 360/390 px e desktop; versão instalada atualizada.
- CPU e franquias Cloudflare Free respeitadas.

**Instrução para a próxima IA:** após cada nova alteração, atualizar
estado dos commits, testes realmente executados, divergências, blockers
e situação de publicação neste roadmap; não confundir commit com deploy.
