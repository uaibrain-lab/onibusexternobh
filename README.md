# Externo — Hub UFMG | Ônibus de Belo Horizonte (P2 local)

**Implementado:** 17/11/2026. **Base GTFS:** `202611161919`. Nenhuma alteração foi feita em sites ou servidores de produção. Este pacote é independente do UaiBrain e de outros projetos. Não contém dados GPS históricos fixos apresentados como atuais.

## Conteúdo funcional

- Catálogo estático real da PBH/SUMOB: **326 linhas, 9.925 paradas, 1.144 traçados e 1.144 padrões** de sequências de paradas (versão GTFS acima).
- Consulta direta dos arquivos GPS públicos em `https://temporeal.pbh.gov.br/?param=D` (convencional/MOVE) e `?param=SD` (suplementar) por um único serviço local; **cache mínimo de 35 segundos** compartilhado entre abas/usuários do mesmo servidor.
- Seleção da posição com maior timestamp `HR` **por `(sistema, NV)`**, mantendo a linha via `NL -> mapa de conversão -> route_id GTFS`.
- Estado de posição persistido em `state/vehicles.json`: o horário `positionUnchangedSinceAt` **NÃO muda** quando a coordenada reaparece em uma resposta mais recente, nem quando o processo reinicia. Oscilações GNSS até 15 m em relação à coordenada âncora não reiniciam esse horário.
- Separação entre `lastGpsFixAt` (HR do GPS), `positionUnchangedSinceAt` (primeira fixação da posição atual) e `lastFetchedAt` (consulta bem-sucedida). Fonte HTTP atualizada **não** implica posição GPS atualizada.
- Identificação de GPS recente (até 2 min), atrasado (2–5 min) e antigo (5–10 min). Veículos de fixação mais antiga que 10 min não são desenhados; registros de estado com mais de 30 min são descartados.
- Associação **conservadora** de posição + histórico com geometrias `shape_id` do GTFS, usando distância à via, orientação, avanço aproximado e diferença de pontuação entre alternativas. Requer três fixações independentes, deslocamento acumulado maior ou igual a 50 m e margem significativa. Quando há ambiguidade, `shapeId=null`.
- Mapa local sem bibliotecas JavaScript externas. Mapas-base carregam blocos de OpenStreetMap **somente se houver internet**; sem eles, posições e rotas continuam desenhadas sobre uma grade simples (não offline cartográfico completo).
- **Interface no padrão da aba Interno do Hub UFMG**: mapa em tela cheia, painel flutuante (desktop), painel inferior expansível (mobile), navegação Pontos/Linhas, temas claro e escuro, pesquisa de todas as paradas, pesquisa de linhas e lista de ônibus. A variante GTFS exibida é referência, não confirmação do itinerário dos veículos.

## Executar no Windows / PowerShell 5.1

1. Extraia `BH-Rastreador-P2.zip` em uma pasta, por exemplo `D:\Downloads\BH-Rastreador-P2`.
2. Instale ou verifique **Python 3.9 ou superior** (não requer pip, npm, Firebase ou API paga).
3. Execute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Downloads\BH-Rastreador-P2\INICIAR-WINDOWS.ps1"
```

4. Abra **http://127.0.0.1:8765** caso o navegador não abra automaticamente; `http://127.0.0.1:8765/externo/` simula o caminho da futura aba do Hub.
5. Pesquise a linha 9202, por exemplo, ou uma linha com veículos ativos naquele horário.

Para encerrar: `Ctrl+C` na janela do PowerShell. **O servidor só consulta os arquivos quando recebe uma requisição; não funciona em segundo plano depois de encerrado.** Se o feed oficial cair, o mapa não vai fingir que o sinal continua atual.

## Rotas locais de teste

- `http://127.0.0.1:8765/api/status`: horário e saúde das fontes e contagem de GPS recente.
- `http://127.0.0.1:8765/api/routes`: 326 linhas GTFS.
- `http://127.0.0.1:8765/api/stops?q=ufmg`: pesquisa estática por nome de parada, com limite de 50 resultados.
- `http://127.0.0.1:8765/api/fleet?route=9202`: veículos com GPS de até 10 minutos para a linha 9202; `shapeMatch` é provável ou ambíguo.
- `http://127.0.0.1:8765/api/route?code=9202`: variantes GTFS sem geometria pesada.
- `http://127.0.0.1:8765/api/route?code=9202&pattern=<ID>`: geometria e paradas da variante escolhida.

O arquivo `state/vehicles.json` é criado após a primeira coleta bem-sucedida. Se você **excluir esse arquivo**, perde o histórico anterior ao reinício, mas o sistema tenta reconstruir parte dele com os registros históricos ainda presentes no arquivo da PBH.

## Testes locais

Na pasta extraída:

```powershell
py -3 -m unittest discover -s tests -v
```

Os testes não consultam a internet. Incluem verificação da persistência dos horários, jitter de GPS, duplicações da API, isolamento de fonte, falhas de rede, associação geométrica e recusa em inventar rotas ambíguas.

## Limites / pendências reais

1. **Não foi testado com as respostas ao vivo da PBH neste ambiente.** As fontes foram validadas no PowerShell do usuário na conversa; os testes do pacote utilizam dados simulados e a interface deve ser verificada no Windows.
2. A API da PBH pode ter limites ou alterar campos/formatos. O retorno usa `Content-Type: text/html` embora seu conteúdo seja JSON; o coletor valida o conteúdo, e não confia no cabeçalho.
3. `SV`, `VL`, `DG` e `DT` requerem validação operacional adicional. A direção `DG` é apenas uma pista fraca no classificador; **não** se assume que `SV` equivale a `direction_id` GTFS.
4. Um traçado classificado `probable` é somente **aproximação geométrica**, não confirmação do serviço/viagem exato. Trechos sobrepostos, desvios, GPS com ruído e linhas circulares podem continuar indeterminados. Para previsão de chegada confiável, será necessário integrar GTFS Realtime/TripUpdates e validar com observações.
5. O protótipo usa um servidor Python ligado em **127.0.0.1**. **Firebase Hosting Spark não executa esse backend**; publicar o front-end estático sozinho não ativa o GPS. Será necessária arquitetura de coleta e cache de produção, compatível com as políticas da fonte, limites do plano gratuito e monitoramento.
6. O uso de tiles públicos do OpenStreetMap neste pacote é apenas para testes locais. **Não publique um site de tráfego elevado consumindo diretamente `tile.openstreetmap.org`** sem revisar a política de uso, atribuição e opções de cache/provedor.
7. Sem infraestrutura, persistência externa ou processo em execução, não se garante rastreamento contínuo. Esta P2 não é uma implantação pública nem executa coleta autônoma 24 horas por dia.

## Estrutura

- `server.py`: API HTTP local e recursos estáticos, acessível somente na própria máquina.
- `transit/engine.py`: cache, ingestão, horários e persistência atômica.
- `transit/matcher.py`: escolha conservadora de `shape_id` com histórico GPS.
- `static/`: interface e mapa canvas (sem dependências JS), reproduzindo o padrão da aba Interno.
- `docs/INTEGRACAO-HUB-UFMG.md`: contrato de design e integração futura por iframe na mesma origem.
- `PUBLICAR-GITHUB-WINDOWS.ps1`: envia a P2 para uma branch de desenvolvimento no novo repositório sem alterar `main`.
- `catalog/`: JSONs GTFS estáticos da etapa P1 (sem snapshot GPS antigo).
- `state/`: persistência criada durante execução.
- `tests/`: testes automatizados offline.

Dados de transporte: Prefeitura de Belo Horizonte/SUMOB, com base GTFS publicada via Mobilibus. Mapa-base: © OpenStreetMap contributors (attribution mantida na interface). Antes de redistribuir ou operar em produção, verificar as licenças e condições vigentes das fontes.

## Publicar em branch de homologação no GitHub (sem deploy)

Na pasta extraída execute `powershell -NoProfile -ExecutionPolicy Bypass -File .\PUBLICAR-GITHUB-WINDOWS.ps1`. Isso cria uma branch `feat/externo-hub-p2-20261117` em `uaibrain-lab/onibusexternobh`, **sem alterar `main` nem o Hub UFMG em produção**. Requer Git for Windows com autorização para acessar o repositório privado.

Referência visual canônica: [`ru-hoje/public/interno/index.html`](https://github.com/uaibrain-lab/ru-hoje/blob/main/public/interno/index.html).

Avisos e licença de terceiros: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
