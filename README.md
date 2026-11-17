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
