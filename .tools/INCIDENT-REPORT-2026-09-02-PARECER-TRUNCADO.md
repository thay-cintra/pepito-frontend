# Relatório de Incidente: campo `text` do parecer de IA cortado no meio da frase

**Data:** 2026-09-02
**Severidade:** 🔴 ALTO (o texto truncado é auto-preenchido como parecer editável da Mesa de Decisão em caso de REPROVAÇÃO real, sem qualquer sinalização de que está incompleto)
**Status:** ✅ RESOLVIDO (código + as 2 entradas afetadas encontradas na auditoria)

---

## Resumo

Thay reportou: "O parecer do caso draft_id 7aa133b6-3689-46ae-9348-4b5382a9acb0 veio incompleto, verifique o que ocorreu e se tem mais algum caso no mesmo cenário."

**Caso reportado** (`7aa133b6`, Jamily De Souza Do Nascimento, CHECK_LIDERANCA — caso vivo na fila): o campo `text` em `pareceres-lideranca.json` terminava sem pontuação, no meio da frase: `"...em município de atuação direta do Vereador, e o vínculo de parentesco em 1º grau é o mais proximal"` — sem o parágrafo final de recomendação.

Esse `text` é auto-preenchido como `parecerCompleto` (editável) na Mesa de Decisão em [NovaAnalise.tsx:97](../src/pages/NovaAnalise.tsx#L97) na primeira vez que o caso é aberto — diferente do `resumo` (incidente de 24/08, já corrigido), que é só um badge informativo, este é o texto que a Liderança pode registrar como decisão final se não perceber o corte.

---

## Causa raiz

`gerar()` em `generate-sugestao-lideranca.py` chamava o LLM com `max_tokens=400` fixo e nenhuma checagem de completude — pegava `r.choices[0].message.content` e persistia direto no JSON, mesmo que a resposta tivesse sido cortada por estourar o limite de tokens de saída.

O caso `7aa133b6` cita **dois achados factuais detalhados** (número de processo, tribunal, datas, natureza do crime) — mais verboso que o padrão dos outros casos — e a geração automática de 2026-09-01 16:50 (`queue-sync`, run `[2/7]`) estourou o orçamento de 400 tokens antes do parágrafo de recomendação.

Auditoria por padrão (texto não termina em `.`, `"`, `!`, `?`) nos 4 arquivos de parecer encontrou um segundo caso na mesma classe de bug, no script irmão `generate-sugestao-parecer.py` (Analista, também `max_tokens=400`):

- `5397f71c` (Carla Suzi Emerenciano), em `pareceres-sugestao.json`, gerado em 2026-08-12: `"...caso descartado, o"` — cortado no meio da palavra. Caso já saiu da fila do Retool e já tem parecer real completo registrado por `m.matos@cora.com.br` em 31/08 — o rascunho de IA truncado ficava órfão, sem nenhum consumidor no app (nenhuma tela lê `getSugestaoParecer()` para um `draft_id` que não está mais na fila viva).

3 outros "suspeitos" no scan (campo `resumo`, entradas `manual-*`) são o achado já documentado e deliberadamente não corrigido no incidente de 24/08 — não fazem parte deste.

**De passagem**, também encontrei e corrigi um vazamento de instrução interna no mesmo `SYSTEM_PROMPT`: a numeração das REGRAS DE DECISÃO (`regra (2)/(3)`, `regra 9`) — pensada só como guia de raciocínio para o modelo — apareceu no texto final de uma entrada (`7e633972`, Evandro Da Silva Santos): *"...configura fator agravante concreto **nos termos da regra (3)(c)(d)**..."*. Corrigido no dado (reescrito em linguagem natural) e no prompt (cláusula PROIBIDO explícita nos dois scripts).

---

## Fix

### Código (`generate-sugestao-lideranca.py` e `generate-sugestao-parecer.py`)

`gerar()` em ambos os scripts agora:
1. Escalona o orçamento de tokens a cada tentativa (`700/1000/1300` na Liderança, `500/800/1100` no Analista) em vez de repetir o mesmo limite que já truncou;
2. Checa `finish_reason == "length"` da resposta da API **e** uma heurística de sanidade (`_parece_completo()`: o texto termina em `.`, `"`, `!`, `?`, `"` ou `)`);
3. Se qualquer um dos dois indicar corte, tenta de novo com o próximo orçamento em vez de persistir;
4. Se esgotar as tentativas ainda cortado, **falha alto** (`RuntimeError`, capturado pelo `try/except` já existente no `main()` de cada script, que loga `❌ falhou` e segue pro próximo caso) — em vez de gravar silenciosamente um parecer incompleto no JSON.

`SYSTEM_PROMPT` de ambos os scripts ganhou uma cláusula PROIBIDO explícita contra citar a numeração interna das regras de decisão no texto do parecer.

### Dados

- `7aa133b6` (Jamily): regenerado via o pipeline real já corrigido (não completado manualmente à mão) — texto termina agora em `"...conforme Circular BACEN 3.978/2020."`.
- `7e633972` (Evandro): frase reescrita à mão, sem citação de regra interna (achado pequeno, não precisou de chamada ao LLM).
- `5397f71c` (Carla, órfão): entrada removida de `pareceres-sugestao.json` — caso fechado, decisão real já registrada em outro lugar, nada no app referencia esse rascunho.

---

## Verificação

- Scan de sanidade (texto não termina em pontuação de fechamento) rodado nos 4 arquivos de parecer antes e depois do fix — 0 suspeitos remanescentes na categoria `text`/`parecer` (os 3 de `resumo` `manual-*` são o achado conhecido de 24/08, fora de escopo).
- `npm run typecheck` e `npm run build` OK após cada rodada de mudança no frontend que consome esses JSONs.
- Servidor reiniciado (`com.cora.pepito.server` via launchd) e confirmado servindo o bundle novo a cada rebuild.

---

## Lições aprendidas

| Lição | Ação |
|-------|------|
| Um `max_tokens` fixo, sem checagem de `finish_reason` nem de completude do texto, é a mesma classe de bug do incidente de 24/08 (corte silencioso) — só que no campo principal (`text`), não no derivado (`resumo`). Corrigir um campo não generaliza a correção para o outro campo do mesmo gerador. | Ao corrigir um bug de truncamento num campo, checar se o mesmo gerador tem outro campo (ou um script irmão) exposto ao mesmo padrão, em vez de assumir que está isolado. |
| Instruções internas do prompt (numeração de regras, pensada só para o raciocínio do modelo) podem vazar para o texto final se não houver proibição explícita — mesmo com exemplos de estilo no prompt não citando regras. | Sempre que o `SYSTEM_PROMPT` usa uma convenção de numeração/rótulo interno para organizar as instruções, adicionar uma cláusula PROIBIDO explícita contra reproduzi-la no output. |
| Um rascunho de IA truncado para um caso que já saiu da fila é dado morto, não um bug a "consertar" completando a frase à mão — completar manualmente conteúdo de parecer PLD sem reprocessar pelo pipeline real introduziria reasoning não verificado. | Antes de corrigir um dado de IA, checar se o caso ainda está na fila viva; se não estiver e já houver decisão real registrada, remover o dado órfão em vez de fabricar uma conclusão. |

---

## Owner & Follow-up

| Item | Responsável | Status |
|------|-------------|--------|
| Guarda de truncamento (`finish_reason` + heurística de frase completa + retry com orçamento maior) nos dois geradores | Claude | ✅ Done |
| Regeneração do caso vivo (`7aa133b6`) via pipeline real | Claude | ✅ Done |
| Remoção do rascunho órfão (`5397f71c`) | Claude | ✅ Done |
| Cláusula PROIBIDO contra citar numeração interna de regras nos dois `SYSTEM_PROMPT` | Claude | ✅ Done |
| Considerar um job periódico (mesmo padrão do `athena-sync-guardrail.sh`) que rode o scan de sanidade de truncamento nos 4 JSONs de parecer após cada `queue-sync`, alertando no Slack em vez de depender de o analista notar visualmente | Thay | ⏳ TODO (sugestão, não bloqueante) |

---

**Incidente fechado.**
