# Contrato de qualidade — Externo BH V1 municipal (22/11/2026)

**Decisão de produto:** a V1 consulta **somente ônibus municipais de Belo Horizonte e metrô**, com pontos, linhas, sentidos/variantes e horários **programados**, além de favoritos e PWA. **Não incluir RMBH/DER, cálculo de rotas, transferências, caminhada OSM ou ETA GPS não homologado.** O agente principal cuida da UI, build, integração e deploy; este PR altera exclusivamente `data_quality/`.

## Gate de lançamento somente leitura

```bash
python -m data_quality.bh_v1_release_gate catalog --date 20261122
python -m data_quality.bh_v1_release_gate catalog --date 20261122 --arrivals-index dist/externo/catalog/arrivals/index.json --require-arrivals
python -m unittest discover -s data_quality -p 'test_*.py' -v
```

- A primeira execução valida referências/cobertura do catálogo municipal, condições de serviço e metadados do metrô, sem construir nada. A segunda é o **gate obrigatório do pacote estático**, após build, e compara o índice dos 256 buckets de chegadas ao mesmo GTFS e ao número de pontos com horário.
- Saída JSON com `status=pass|blocked`, `errors`, `warnings`, data consultada, versão, validade, contagens e SHA-256 da **origem ZIP**. O processo retorna exit code `2` quando o gate é bloqueado. Não altera arquivos nem rede.
- `stops_without_scheduled_arrivals` é diagnóstico, **não autorização para inventar previsão**. Valida-se a existência do hash da origem, mas ele sozinho **não prova** que cada artefato foi derivado desse mesmo ZIP. A homologação completa exige build atômico e testes do agente principal.
- A data de serviço precisa estar dentro de `feedStartDate`/`feedEndDate`, com ao menos um serviço ativo segundo `timetable-calendar.json`. Exceções são aplicadas apenas quando os IDs correspondem a serviços do catálogo. Dados vencidos ou incompatíveis bloqueiam a publicação.

## Evidência do catálogo existente, inspecionado via GitHub

Na branch-base de integração, versão `202611161919`, validade publicada `20261231`: **326 linhas**, **9.925 paradas** (nenhuma coordenada fora dos limites numéricos), **9.828 paradas com horários**, **6.691.004 registros de passagens**. Em **22/11/2026 (domingo)**: serviços municipais `307680` e `307683` ativos segundo o calendário persistido. Metrô cadastrado com **22 estações**, **2 linhas**, e sem referências de estações inexistentes. O total do catálogo e o calendário conferem. Isso **não equivale a teste HTTP do site, prova da origem do GTFS, garantia de operação em campo ou validação de tempos reais**.

Um detalhe a corrigir com o agente principal na etapa de empacotamento: o `manifest.json` lista `coverage-diagnostic.json`, mas esse arquivo não está presente na raiz do catálogo da branch-base consultada. Verificar se deve ser removido do manifesto ou produzido pelo build, sem misturar dados de fontes.

## Handoff para o agente principal

1. Ocultar a aba **Rotas** na V1 sem apagar o código e não exibir RMBH. `data_quality` não altera UI.
2. Incluir o gate de **pacote estático** em CI e no procedimento de homologação/preview (o agente principal é dono de CI/build).
3. Confirmar a renovação atômica de GTFS/chegadas/manifesto, conforme políticas de validade; não publicar a V1 com índice ausente/divergente.
4. Executar testes Python, JS, HTTP e Android real; medir custo de banda; manter GPS gratuito como opcional **desabilitado** até homologação da fonte/Worker.
5. Somente após homologação, pedir autorização separada para merge/deploy no Hub UFMG; sem qualquer modificação de `main` nesta branch.

Os testes do gate usam apenas fixtures sintéticas e nenhum horário fictício é divulgado como oficial.
