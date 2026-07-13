# Relatório de Incidente: 4 Bugs — Parecer IA, Monitoramento Reforçado, CNAE e Supervisor

**Data:** 2026-07-13
**Severidade:** 🟠 ALTO (regra de negócio PLD/FT)
**Status:** ✅ RESOLVIDO

---

## Resumo

Quatro bugs reportados na aplicação, nenhum detectado pelo Supervisor nem alertado no Slack:

1. Parecer Sugestão IA ausente em alguns casos das filas CHECK_ANALISTA/CHECK_LIDERANCA.
2. Derivação excessiva para Monitoramento Reforçado usando "PEP Ativo"/"vínculo ativo" isoladamente.
3. Cruzamento de CNAE por prefixo (classe/grupo) confundindo subclasses distintas e majorando risco indevidamente.
4. Supervisor sem cobertura para os 3 bugs acima (só verifica saúde estrutural, não regra de negócio).

---

## Bug 1 — Parecer Sugestão IA ausente

**Causa raiz:** `refresh-daily.sh` regenera os JSONs de dados/pareceres diariamente via cron, mas nunca rodava `npm run build`. Como `registration-enrich.ts` importa os JSONs de pareceres estaticamente (compilados no bundle Vite em build-time), qualquer sugestão gerada pelo cron ficava presente no arquivo-fonte mas ausente do bundle publicado até o próximo build manual (botão "Refresh").

**Fix:** `.tools/refresh-daily.sh` agora roda `npm run build` como etapa `[7/7]`, sempre após a regeneração de dados/pareceres.

**Arquivos:** `.tools/refresh-daily.sh`

---

## Bug 2 — Derivação incorreta para Monitoramento Reforçado

**Causa raiz:** `gerarParecerAnalista()` em `src/data/registration-enrich.ts` usava a condição `altoExterno || c.bucket === "CHECK_LIDERANCA"` — ou seja, **todo** caso da fila CHECK_LIDERANCA (que por definição envolve PEP/vínculo ativo) era derivado para Monitoramento Reforçado, mesmo sem nenhum achado de mídia, processo ou risco externo confirmado.

**Fix:** condição alterada para `altoExterno || (c.bucket === "CHECK_LIDERANCA" && algumSinal)` — `algumSinal` exige achado materializado (mídia, processo judicial ou achado externo de risco). PEP/vínculo ativo isolado, sem achado, agora segue para aprovação padrão (alinhado com `recomendacaoSugerida()`, que já seguia essa regra).

**Arquivos:** `src/data/registration-enrich.ts` (função `gerarParecerAnalista`)

---

## Bug 3 — Cruzamento incorreto de CNAE

**Causa raiz:** `generate-pld-risk-scores.py` comparava o CNAE do caso contra `CNAES_PROIBIDAS_CORA` truncando para 5 dígitos (classe, sem subclasse) ou 4 dígitos (grupo), via `cp7.startswith(c)`. Isso fazia com que **qualquer subclasse** da mesma classe fosse tratada como proibida — ex.: `4789-0/07` (escritório) sendo confundido com `4789-0/09` (armas e munições), pois ambos compartilham os 5 primeiros dígitos.

**Fix:** `CNAES_PROIBIDAS_CORA` agora guarda o código **exato de 7 dígitos** (classe+subclasse) e o match é por igualdade exata (`cp7 in CNAES_PROIBIDAS_CORA`), nunca por prefixo. Um novo conjunto separado, `CNAES_PROIBIDAS_CLASSE`, cobre apenas as 3 classes cuja fonte documenta explicitamente que **todas** as subclasses são de risco (wildcard `/0x`/`xx` na descrição original) — nesse caso, e só nesse caso, o match por classe (4 dígitos) é intencional.

**Arquivos:** `.tools/generate-pld-risk-scores.py` (`CNAES_PROIBIDAS_CORA`, `CNAES_PROIBIDAS_CLASSE`, `calcular_score`). `src/data/pld-risk-scores.json` regenerado com o fix.

---

## Bug 4 — Supervisor sem detecção / sem alerta Slack

**Causa raiz:** `.tools/supervisor-agent.py` só verificava saúde estrutural (servidor up, arquivos existem/são JSON válido, build recente, git limpo) — nenhum check validava regra de negócio (cobertura de pareceres, taxa de derivação para Monitoramento Reforçado).

**Fix:** dois novos checks adicionados a `SupervisorAgent`:
- `check_cobertura_pareceres_sugestao()` — compara `draft_id` da fila (`registration-queue-real.json`) contra `pareceres-sugestao.json`/`pareceres-lideranca.json`; alerta 🟠 ALTO se algum caso não tiver sugestão com `text`.
- `check_taxa_monitoramento_reforcado()` — alerta 🟡 MÉDIO se >70% dos pareceres de CHECK_LIDERANCA sugerirem Monitoramento Reforçado (sinal de regra de negócio usando vínculo PEP isolado como critério).

Ambos rodam em `executar_todas_verificacoes()` e reaproveitam o pipeline de alerta Slack já existente.

**Arquivos:** `.tools/supervisor-agent.py`

---

## Verificação

- `npm run typecheck` — OK.
- `npm run build` — OK, servidor reiniciado com bundle atualizado.
- `python .tools/generate-pld-risk-scores.py` — rodado, `pld-risk-scores.json` regenerado (4 casos com `cnae_proibida` corrigidos).
- `python .tools/supervisor-agent.py` — rodado com os 2 novos checks ativos, sem falso positivo.
