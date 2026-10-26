# Relatório de Incidente: segundo PEP distinto descartado silenciosamente na Sugestão IA

**Data:** 2026-10-26
**Severidade:** 🟠 ALTO (informação materialmente incompleta para decisão PLD/FT)
**Status:** ✅ RESOLVIDO

---

## Resumo

Ao gerar os 55 pareceres de Analista que faltavam na fila (LiteLLM com orçamento esgotado, geração
via MCP Codex), a revisão manual pós-geração encontrou 3 casos do lote em que a Sugestão IA citava
só **um** dos dois PEPs distintos vinculados ao cadastro, ignorando completamente o segundo — em um
deles (`0a7d161c`), o PEP omitido era um **Prefeito em exercício, sócio direto confirmado** do
titular numa empresa ativa, achado que mudava a recomendação de MONITORAMENTO REFORÇADO para
REPROVAÇÃO. Uma varredura na fila completa encontrou mais 1 caso pré-existente com o mesmo padrão
(`33864c75`, já havia sido corrigido manualmente em 2026-09-23, antes da causa raiz ser conhecida).

Total: **4 casos** em toda a fila viva têm `pep_pf` com mais de uma pessoa distinta (`cpf_titular`
diferentes) — não confundir com reeleição (mesma pessoa, múltiplos mandatos), que já era tratada
corretamente desde o incidente de 2026-08-12.

---

## Causa raiz

`_registro_pep_principal()` (presente em `.tools/generate-sugestao-parecer.py`,
`.tools/generate-sugestao-lideranca.py`, e sua versão TypeScript `registroPepPrincipal()` em
`src/data/registration-enrich.ts`) foi desenhada para escolher o mandato **vigente** entre múltiplos
registros de **reeleição da mesma pessoa** — funciona perfeitamente para esse caso. O problema: ela
escolhe 1 único registro entre **todos** os registros de `pep_pf`, sem primeiro verificar se esses
registros pertencem à mesma pessoa (`cpf_titular`). Quando o titular tem vínculo com **dois PEPs
diferentes ao mesmo tempo** (ex.: sócio de dois PEPs em empresas distintas; irmã de dois
Deputados), a função despreza qual dos dois tem o `data_fim` mais distante e descarta o outro
silenciosamente — sem erro, sem aviso, o prompt enviado ao LLM nunca menciona o PEP descartado.

No lado TypeScript (frontend), o impacto é limitado: `registroPepPrincipal()` só alimenta o resumo
de cabeçalho do card (`RegistrationCaseCard.tsx`), que já tem uma tooltip avisando "Registro mais
atual entre N vínculo(s) PEP na base — ver Resultados da Pesquisa para todos" — e a lista completa
de "Resultados da Pesquisa" (`gerarResultados()`) **já itera sobre todos os registros de `pep_pf`**,
sem usar `registroPepPrincipal()`. Ou seja, o analista humano sempre teve acesso ao PEP completo na
tela; só a Sugestão IA (que só vê o que `montar_user_prompt()` constrói) ficava cega para o segundo
PEP.

---

## Fix

**`.tools/generate-sugestao-parecer.py` e `.tools/generate-sugestao-lideranca.py`** (idêntico nos
dois arquivos, mantendo a duplicação já convencionada no projeto):

- Nova função `_registros_pep_distintos(pep_pf)` — agrupa os registros por `cpf_titular` e aplica
  `_registro_pep_principal()` **dentro de cada grupo** (resolve reeleição corretamente por pessoa),
  devolvendo 1 registro por pessoa distinta.
- Nova função `_empresa_comum_ph3a(nome_pep, findings)` — procura um achado PH3A de "sociedade em
  comum" citando aquele PEP pelo nome; quando existe, devolve o snippet real (empresa + CNPJ +
  situação cadastral já confirmados). Corrige um problema correlato: o aviso fixo de REGRA 12
  ("Credilink não informa em qual empresa... não presuma") era mostrado mesmo quando o PH3A já
  tinha identificado a empresa em comum — o LLM recebia uma instrução desatualizada.
- `montar_user_prompt()`: quando há mais de 1 PEP distinto, monta um bloco por PEP (`_bloco_vinculacao_pep`)
  e acrescenta uma instrução explícita — citar todos, decisão final reflete o de maior risco entre
  eles. Quando há só 1 PEP (o caso comum, ~99% dos casos), o formato do prompt permanece
  **byte-a-byte idêntico** ao anterior (testado por regressão) — só ganha o fix do `_empresa_comum_ph3a`.

**Validado** rodando `montar_user_prompt()` dos dois scripts contra os 4 casos reais afetados
(`0a7d161c`, `5658c4bb`, `b8127ed6`, `33864c75`) e contra um caso normal de 1 PEP (regressão) — ambos
os PEPs aparecem no prompt nos 4 casos, achado PH3A de empresa em comum é citado corretamente
quando existe, e o caso normal produz exatamente o mesmo texto de antes.

**Arquivos:** `.tools/generate-sugestao-parecer.py`, `.tools/generate-sugestao-lideranca.py`

---

## Regeneração dos casos afetados

Os 3 casos do lote de 2026-10-26 (`0a7d161c`, `5658c4bb`, `b8127ed6`) foram reescritos manualmente
antes deste fix de código (ver commit `f441dee`) — a reescrita manual já cobria ambos os PEPs
corretamente, incluindo o achado PH3A. O caso `33864c75` já havia sido corrigido manualmente em
2026-09-23. Nenhuma regeneração adicional foi necessária agora; o fix de código serve para que
**futuros** casos com o mesmo padrão não precisem de correção manual caso a caso.

---

## Lições aprendidas

| Lição | Ação |
|-------|------|
| Uma função de "escolher o principal entre múltiplos registros" presumia implicitamente que todos os registros eram da mesma pessoa — nunca verificado | Antes de escolher "o principal" entre N registros, sempre checar primeiro se N registros = N mandatos de 1 pessoa ou N pessoas distintas |
| O aviso fixo de "empresa em comum não identificada" (REGRA 12) não verificava se um achado de outra fonte (PH3A) já tinha resolvido a lacuna | Avisos de "dado faltante" no prompt devem checar o estado atual dos achados antes de disparar, não ser incondicionais |
| O mesmo bug já existia potencialmente desde 2026-08-12 (introdução de `_registro_pep_principal`) sem ser pego por nenhum teste — só foi achado por revisão manual caso a caso | Dado o baixo volume (4 casos em ~500), uma varredura programática por `len(set(cpf_titular)) > 1` é barata e deveria rodar como parte do Supervisor Agent, não só de uma revisão manual pontual |

---

## Owner & Follow-up

| Item | Responsável | Status |
|------|-------------|--------|
| `_registros_pep_distintos()` + `_empresa_comum_ph3a()` nos dois scripts Python | Claude | ✅ Done |
| Teste de regressão (prompt de caso normal idêntico ao anterior) | Claude | ✅ Done |
| Adicionar a mesma varredura (`len(set(cpf_titular)) > 1`) como checagem automática no Supervisor Agent | Thay | ⏳ TODO (fora do escopo deste fix) |
| Portar o mesmo conceito para `registroPepPrincipal()` (TypeScript), caso algum outro consumidor futuro do card-resumo passe a depender dele além da tooltip já existente | Thay | ⏳ TODO (hoje não é um problema real — `gerarResultados()` já mostra todos — mas vale rastrear se isso mudar) |

---

**Incidente fechado.**
