# Relatório de Incidente: Mandato de PEP ativo não identificado + resultados de pesquisa sem distinção verificado/pendente

**Data:** 2026-08-12
**Severidade:** 🟠 ALTO (informação materialmente incorreta para decisão PLD/FT)
**Status:** ✅ RESOLVIDO

---

## Resumo

No caso `d309057d-dd08-4d81-b81b-dc775d35144b` (titular Ronaldo Ramos Dias, irmão do Vereador Elias Ramos Dias — São Vicente de Minas/MG), o Pepito não deixava claro que o mandato do PEP está **ativo** (confirmado pelo analista via [site oficial da Câmara](https://camarasvm.mg.gov.br/m/Dados_Vereador&INT_PES=575#)). Os "Resultados da Pesquisa" mostravam dois registros "Base PEP unificada" quase idênticos, sem indicar qual mandato está vigente, e um card de busca do TSE com a mesma força visual (Risco Alto, Similaridade 100%) de um achado já confirmado — quando na verdade é só um link de busca ainda não verificado.

---

## Bug 1 — Mandato ativo não identificado

**Causa raiz:** `pep_pf` traz **dois registros** para o mesmo PEP (reeleição — um por mandato: 2021-2024 e 2025-2028). `inferCargoOrgao()` escolhia o "principal" filtrando por `p.tipo === "T"` e pegando o primeiro (`titulares[0]`) — mas o campo `tipo` (T/R) da Credilink **não indica recência**: nesse caso o mandato já ENCERRADO (2021-2024) veio com `tipo: "T"` e o mandato ATIVO (2025-2028) veio com `tipo: "R"`. Resultado: o app usava o termo errado (expirado) como referência, e **nenhum lugar do código** de fato comparava `data_fim`/`data_fim_carencia` com a data de hoje para determinar "ativo/carência/encerrado" — apesar de o README já documentar esse guardrail como se existisse.

**Fix (`src/data/registration-enrich.ts`):**
- Nova função `statusMandato(p)` — compara `data_fim`/`data_fim_carencia` (dd/mm/yyyy) com hoje e retorna `"ativo" | "carencia" | "encerrado" | "indeterminado"`.
- Nova função `registroPepPrincipal(entradas)` — entre múltiplos registros PEP, prioriza o mandato **ativo agora**; senão o de `data_fim` mais recente; só cai na heurística antiga (`tipo === "T"`) se nenhum registro tiver data parseável.
- `inferCargoOrgao()` passa a usar `registroPepPrincipal` (não mais `titulares[0]`) e retorna também `statusMandato`/`statusMandatoLabel`.
- Bloco "Base PEP unificada" em `gerarResultados()` agora inclui o período do mandato e o status (🟢 ativo / 🟡 carência / ⚪ encerrado) no resumo de cada registro — o analista vê os dois mandatos claramente distintos, não duas linhas quase-idênticas.
- `RegistrationCaseCard.tsx`: badge de status de mandato adicionado ao cabeçalho do caso (ao lado de Cargo/Órgão), visível na fila sem precisar abrir os 31 resultados.
- Também corrigido, mesma causa: `isOwnerTitular` (flag "⚠️ O próprio owner é o PEP") não deve mais depender de `p.tipo === "T"` — comparava só `cpf_titular` com o CPF do owner, que é o que importa.

**Arquivos:** `src/data/registration-enrich.ts`, `src/components/RegistrationCaseCard.tsx`

---

## Bug 2 — Resultados de pesquisa sem distinção "confirmado" vs "pendente de verificação manual"

**Causa raiz:** `verify-links.ts` gera *deep-links* de busca (URL pré-preenchida) — nenhum deles é um achado verificado, são links para o analista abrir e conferir. `toResultado()` (que embrulha esses links em `ResultadoPesquisa`) já suporta uma flag `pendente_verificacao` que renderiza um badge "⚠️ Pendente verificação" (`ResultadoCard.tsx`), mas ela só era usada quando havia perda de sinal — o único card de **risco alto** vindo de deep-link (TSE — Divulgação de Candidaturas, "Validar mandato/candidaturas...") não usava a flag, ficando visualmente idêntico a um achado real da base própria (ex.: "Base PEP unificada"), quando na verdade ninguém tinha verificado a fonte ainda.

**Fix:** `pendente: true` na chamada `toResultado()` do card TSE; resumo reescrito para deixar explícito que é link de busca não verificado automaticamente ("Confirmar... Link de busca; analista deve abrir e conferir manualmente"). Comentário de `toResultado()` atualizado para deixar esse contrato explícito para o próximo dev que adicionar uma chamada com `risco: "alto"`.

**Arquivos:** `src/data/registration-enrich.ts`

---

## Verificação

- Lógica de `statusMandato`/`registroPepPrincipal` replicada em Node e testada contra o `pep_pf` real do draft `d309057d...`: registro 2025-2028 (`tipo: "R"`) corretamente identificado como `ativo` e escolhido como principal; registro 2021-2024 (`tipo: "T"`) corretamente identificado como `carencia`.
- `npm run build` — OK, sem erros de TypeScript.
- Strings novas confirmadas no bundle compilado via grep direto (`mandato ATIVO`, `em carência PLD`, `Confirmar mandato/candidaturas`, badges do card).
- Servidor reiniciado, bundle novo no ar.

---

## Lições aprendidas

| Lição | Ação |
|-------|------|
| Um campo de código de fonte externa (`tipo` T/R da Credilink) foi usado como proxy para "recência"/"qual é o vigente" sem essa garantia documentada pela fonte | Nunca inferir ordenação/recência de um campo categórico sem confirmar a semântica; preferir comparar datas explícitas quando disponíveis |
| README documentava um guardrail ("Data fim do mandato comparada com data atual") que não existia em código | Guardrail documentado ≠ guardrail implementado — auditar periodicamente se a documentação reflete o código real, não o inverso |
| Badge "Pendente verificação" já existia mas não era aplicado de forma consistente a todo card de risco alto vindo de deep-link | Tratar `pendente_verificacao` como obrigatório (não opcional) para qualquer `toResultado()` com `risco !== "baixo"` |

---

## Owner & Follow-up

| Item | Responsável | Status |
|------|-------------|--------|
| `statusMandato`/`registroPepPrincipal` em `registration-enrich.ts` | Claude | ✅ Done |
| Badge de mandato no `RegistrationCaseCard.tsx` | Claude | ✅ Done |
| `pendente: true` no card TSE | Claude | ✅ Done |
| Expor status de mandato também em `NovaAnalise.tsx` (hoje só mostra `cargoPep` como texto puro, sem período/status — fica correto via `resultados_pesquisa` mas não no resumo de cabeçalho) | Thay | ⏳ TODO (fora do escopo deste fix — requer tocar `ClienteData`/`synthesizeAnalise`) |

---

**Incidente fechado.**
