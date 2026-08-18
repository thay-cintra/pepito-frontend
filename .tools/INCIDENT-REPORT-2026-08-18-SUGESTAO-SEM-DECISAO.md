# Relatório de Incidente: badge "Sugestão IA" (CHECK_ANALISTA) divergindo do texto do parecer — dois padrões novos na frase final

**Data:** 2026-08-18
**Severidade:** 🟠 ALTO (badge/filtro/contador de "Sugestão IA" mostrava algo diferente do parecer real da IA)
**Status:** ⚠️ PARCIALMENTE RESOLVIDO (1 de 2 padrões corrigido; o segundo é limitação conhecida, sem fix seguro identificado ainda)

---

## Resumo

Pedido do analista: "corrija o bug de sugestão de parecer IA". Sem um draft específico apontado, foi feita uma auditoria completa (recalculando `decisaoFromTextoAnalista()` sobre todo `pareceres-sugestao.json`, 284 entradas) comparando a decisão que o código já corrigido em 2026-08-13 produziria contra o texto real de cada parecer. Encontrados 5 casos onde a última frase do parecer não bate com a categoria que o código atribuiria — 2 deles em drafts **vivos** na fila CHECK_ANALISTA (`719f82b4`, `e59f5e1a`), os outros 3 em entradas históricas/órfãs (não aparecem na fila atual).

Mesma causa raiz de fundo do incidente de 2026-08-13 (busca de palavra-chave restrita à frase final, ver `INCIDENT-REPORT-2026-08-13-DECISAO-DIVERGENTE-DO-TEXTO.md`), mas dois padrões de frase final que aquele fix não cobria.

---

## Causa raiz — Padrão 1 (CORRIGIDO)

`decisaoFromTextoAnalista()` (`src/data/registration-enrich.ts`) só reconhecia aprovação pela palavra "APROVA" na frase final. O próprio template do `SYSTEM_PROMPT` (`.tools/generate-sugestao-parecer.py`) usa, no exemplo de referência, a construção "não temos objeções ao início do relacionamento, sugerimos a APROVAÇÃO" — mas quando o modelo encerra a frase só com a primeira parte ("não temos objeções ao início do relacionamento.") sem repetir "APROVAÇÃO" por extenso, a função não reconhecia nenhuma palavra-chave e caía no default `"monitoramento"`.

**Caso real:** draft `f2a4b186` (histórico, não vivo) — texto começa com "Cadastro **aprovado** pelo time de PLD" e termina em "...não temos objeções ao início do relacionamento." Decisão recalculada pelo código antigo: `monitoramento`. Decisão real: `aprovado`.

### Fix

`decisaoFromTextoAnalista()` agora reconhece `NÃO TEMOS OBJE...` / `SEM OBJEÇÃO` na frase final como sinal de aprovação (mesmo nível de prioridade do `t.includes("APROVA")`, depois dos checks de FALSO POSITIVO / REPROVA / MONITORAMENTO REFORÇADO — sem alterar a ordem de precedência já corrigida em 2026-08-13).

**Verificação:** reauditoria das 284 entradas de `pareceres-sugestao.json` — apenas `f2a4b186` mudou de classificação (`monitoramento` → `aprovado`); nenhuma regressão nas outras 283. `npx tsc --noEmit` limpo. `npm run build` OK.

---

## Causa raiz — Padrão 2 (NÃO CORRIGIDO — limitação conhecida)

O `SYSTEM_PROMPT` exige que o parecer termine em uma de 3 recomendações (APROVAÇÃO / MONITORAMENTO REFORÇADO / REPROVAÇÃO), mas não tem uma regra explícita para o cenário "vínculo PEP identificado (ex.: via Credilink) porém sem nome/cargo/mandato suficientes para caracterizar". Nesse cenário o modelo, em pelo menos 2 casos vivos, produziu uma frase final que **não decide nada** — pede diligência complementar em vez de escolher uma das 3 categorias:

- `719f82b4` (GS RAÇÕES LTDA): "...recomendamos que o caso seja submetido a diligências complementares para identificação plena do PEP antes de qualquer deliberação, ficando a recomendação final condicionada ao resultado dessas informações adicionais."
- `e59f5e1a` (Elvis de Souza Santos): "...recomendamos a complementação das informações junto ao cliente antes de concluir a análise, ficando a recomendação final condicionada ao esclarecimento desses dados."

Nenhuma das 3 palavras-chave aparece. O código (antes e depois deste incidente) cai no `return "monitoramento"` por padrão — o que **fabrica** uma decisão ("Monitoramento Reforçado", categoria com definição estrita na regra 9 do próprio `SYSTEM_PROMPT`: exige vínculo PEP + fator de risco adicional concreto) que o texto nunca afirmou.

### Por que não foi corrigido agora

A correção óbvia — cair no fallback estrutural `recomendacaoSugerida(c)` quando nenhuma palavra-chave é encontrada, como o comentário já-existente em `getDecisaoIA` sugere ("Fallback: heurística antiga") — foi **testada e descartada**: para os 2 casos reais, `recomendacaoSugerida` decide `"falso_positivo"`, porque o campo estruturado `pep_pf` está vazio (`[]`) nos dois. Isso contradiz o próprio texto do parecer, que registra um vínculo PEP (via Credilink) só com dados incompletos — `falso_positivo` sugere "nada aqui", o que é uma classificação ainda mais enganosa que o `"monitoramento"` atual. `pep_pf` estruturado (fila) e o texto do parecer LLM (gerado em outro momento/pipeline) estão dessincronizados nesses casos — problema de consistência de dados separado, fora do escopo deste fix.

Mantido `"monitoramento"` como default conservador (categoria intermediária, não fecha o caso em nenhuma direção) até que uma das duas ações abaixo resolva na origem.

---

## Verificação

- Reauditoria de `pareceres-lideranca.json` (Python, `detect_decisao()`): 0 divergências nas 15 entradas atuais.
- Reauditoria de `pareceres-sugestao.json` (284 entradas): 1 mudança de classificação (`f2a4b186`), 4 entradas continuam sem palavra-chave na frase final (Padrão 2) — 2 vivas (`719f82b4`, `e59f5e1a`), 2 históricas/órfãs.
- `npx tsc --noEmit` — OK. `npm run build` — OK.
- Bundle novo (`index-Bv7VzBKb.js`) confirmado servido após restart do servidor.

---

## Lições aprendidas

| Lição | Ação |
|-------|------|
| A mesma função de extração pode ter múltiplos padrões de frase final não cobertos — corrigir um caso reportado não esgota a classe do bug | Sempre auditar a base inteira (recalcular a função corrigida contra todo o dataset) em vez de só validar o caso reportado |
| Um campo "estruturado" (`pep_pf`) não é necessariamente mais confiável que o texto do LLM — os dois podem vir de pipelines/momentos diferentes e dessincronizar | Antes de usar um fallback estrutural para cobrir um buraco de extração de texto, testar o fallback contra os dados reais do caso, não assumir que é mais seguro por ser "estruturado" |
| Quando o modelo quebra o contrato do próprio `SYSTEM_PROMPT` (não termina em uma das categorias exigidas), o bug de raiz está potencialmente na geração, não na extração — mas regenerar via LLM ou mudar a política de negócio (o que fazer quando dados do PEP são insuficientes) é decisão do time de PLD, não do código | Documentar como limitação conhecida e escalar para decisão do dono do produto em vez de fabricar uma correção de extração não verificada |

---

## Owner & Follow-up

| Item | Responsável | Status |
|------|-------------|--------|
| `decisaoFromTextoAnalista()` reconhece "não temos objeções"/"sem objeção" como aprovação | Claude | ✅ Done |
| Decidir política para "vínculo PEP identificado mas dados insuficientes" (regra no `SYSTEM_PROMPT` + regenerar os 2 drafts vivos com terminação decisiva) | Thay | ⏳ TODO |
| Investigar dessincronia `pep_pf` (fila) vs. texto do parecer LLM nos 2 casos vivos — por que a fila mostra `pep_pf: []` quando o parecer descreve um vínculo Credilink | Thay | ⏳ TODO |

---

**Incidente parcialmente fechado — Padrão 2 requer decisão de política PLD antes de codar um fix.**
