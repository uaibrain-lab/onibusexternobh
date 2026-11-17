# Contrato de integração — Externo / Hub UFMG

**Referência visual:** [Interno](https://github.com/uaibrain-lab/ru-hoje/blob/main/public/interno/index.html) no projeto [Hub UFMG](https://github.com/uaibrain-lab/ru-hoje).

O rastreador Externo deverá seguir a mesma navegação e identidade visual da aba Interno:

- Mapa como elemento principal, ocupando a tela inteira.
- Painel flutuante à esquerda em desktop (aproximadamente 346px), inferior expansível no celular.
- Botões **Pontos** e **Linhas** no topo do painel.
- Seleção de ponto que centraliza o mapa e abre o painel.
- Busca de paradas da cidade e de linhas, exibindo trajetos GTFS e posições GPS.
- Cores, fonte, bordas, marcadores e contraste inspirados no `public/interno/index.html`.
- Tema claro/escuro, incluindo futura sincronização com o Hub.
- Sem cabeçalho comercial próprio, para funcionar dentro da futura aba **Externo**.

## Integração prevista

Manter projeto independente até homologação. Expor o componente em `/externo/` com arquivos estáticos relativos e API sob `/externo/api/*`; incorporar como iframe de mesma origem no Hub. **Não alterar agora** `ru-hoje`, `hubufmg.web.app` ou a aba Interno.

O protótipo P2 pode rodar no Windows com Python 3.9+, mas **Firebase Hosting estático não executa o backend**. A hospedagem de produção do coletor/cache ainda precisa ser definida.

## Veracidade de GPS

Guardar três horários: última coleta HTTP, último sinal GPS do veículo e desde quando a posição permanece inalterada. Repetir coordenada não pode renovar o horário exibido da posição; nunca atribuir percurso à força quando as variantes GTFS forem ambíguas.

## Fontes

- [GPS convencional/MOVE](https://temporeal.pbh.gov.br/?param=D)
- [GPS suplementar](https://temporeal.pbh.gov.br/?param=SD)
- [GTFS estático](https://s3.amazonaws.com/mobilibus-uploads/gtfs/GTFSBHTRANS.zip)
- [Hub / Interno](https://github.com/uaibrain-lab/ru-hoje/blob/main/public/interno/index.html)

**Status:** contrato de design e protótipo local P2; ainda não implantado no Hub.