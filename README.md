# Ônibus Externo BH

Rastreador experimental dos ônibus de Belo Horizonte, desenvolvido de forma independente.

## Estado

**P2 — protótipo local (homologação pendente).** A base estática vem do GTFS da PBH/SUMOB. Os arquivos JSON da PBH disponibilizam posições de ônibus convencionais/MOVE e suplementares.

O motor separa `lastGpsFixAt` (horário do sinal), `positionUnchangedSinceAt` (desde quando a coordenada permanece inalterada) e `lastFetchedAt` (última consulta). **Uma requisição recente jamais transforma automaticamente uma posição antiga em atual.**

Os ônibus são associados a traçados apenas quando há evidência suficiente; na dúvida, o trajeto é marcado como ambíguo.

## Fontes de dados

- GTFS: https://s3.amazonaws.com/mobilibus-uploads/gtfs/GTFSBHTRANS.zip
- GPS convencional e MOVE: https://temporeal.pbh.gov.br/?param=D
- GPS suplementar: https://temporeal.pbh.gov.br/?param=SD
- Portal de dados abertos: https://dados.pbh.gov.br/

## Execução da P2

A aplicação P2 roda localmente em Python 3.9+ (biblioteca padrão), sem Firebase, npm ou serviços pagos. Após a incorporação dos arquivos-fonte à árvore deste repositório, execute `INICIAR-WINDOWS.ps1` no Windows e acesse `http://127.0.0.1:8765`.

Testes: `py -3 -m unittest discover -s tests -v`.

**Importante:** esta primeira revisão apenas inicializa o repositório. O código e o catálogo da P2 devem ser importados antes que os comandos de execução funcionem. Não há implantação pública, serviço permanente ou consulta de GPS em produção.

Dados: PBH/SUMOB. Mapa-base: © OpenStreetMap contributors. Verificar licenças, políticas de redistribuição e limites de uso antes da publicação pública.

## Direção de design — futura aba Externo do Hub UFMG

O design deve reproduzir a navegação da [aba Interno do Hub UFMG](https://github.com/uaibrain-lab/ru-hoje/blob/main/public/interno/index.html): mapa ocupando a tela, painel flutuante à esquerda no desktop e inferior expansível no celular, botões **Pontos** / **Linhas**, tema automático e seleção de parada com centralização do mapa.

Requisitos completos: [docs/INTEGRACAO-HUB-UFMG.md](docs/INTEGRACAO-HUB-UFMG.md).

**Situação:** a versão de código P2 com esse visual foi preparada e testada localmente, mas o código-fonte ainda precisa ser importado ao repositório pela branch de homologação (o diretório `main` ainda só contém a documentação). Não há deploy público.
