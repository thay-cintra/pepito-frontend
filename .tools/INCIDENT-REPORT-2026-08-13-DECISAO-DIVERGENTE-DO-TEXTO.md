# Relatório de Incidente: Decisão estruturada divergia do texto do parecer (busca de palavra-chave ingênua no corpo inteiro)

**Data:** 2026-08-13
**Severidade:** 🟠 ALTO (badge/filtro de decisão mostrava o oposto do parecer real da IA)
**Status:** ✅ RESOLVIDO

---

## Resumo

Reportado pelo analista: draft `1a38bc16-bd1e-42f5-9e4d-f011dc08850f` (ESPACO LUGAR DE FALA LTDA, CHECK_LIDERANCA) apareceu classificado como **Falso Positivo**, mas o parecer completo dizia claramente "Decisão: CADASTRO APROVADO SOB MONITORAMENTO REFORÇADO". Auditoria encontrou a mesma causa raiz em mais dois casos (um histórico, um vivo em CHECK_ANALISTA) e uma vulnerabilidade análoga no lado TypeScript.

---

## Causa raiz

`detect_decisao()` (`.tools/generate-sugestao-lideranca.py`) extrai a decisão fazendo `"FALSO POSITIVO" in text.upper()` — **busca no texto inteiro**, não na linha `Decisão:` que o próprio template exige como primeira linha. O parecer de `1a38bc16` diz, no corpo (não no cabeçalho): *"...sem qualquer relação com o titular ou a empresa; **descartado como falso positivo**."* — referindo-se a uma notícia irrelevante (match de frase genérica "lugar de fala"), não à decisão do caso. Como o check de `"FALSO POSITIVO"` vem **primeiro** na cadeia de `if`, essa menção no corpo sequestra a classificação do caso inteiro.

Auditoria de toda a base (recalculando `detect_decisao()` sobre o texto já armazenado, sem chamar o LLM) encontrou mais um caso:

| Draft | Status | Decisão armazenada (errada) | Decisão real (linha "Decisão:") |
|---|---|---|---|
| `1a38bc16` | vivo (CHECK_LIDERANCA) | falso_positivo | APROVADO SOB MONITORAMENTO REFORÇADO |
| `bda5cef7` | histórico (não vivo) | monitoramento | APROVADO |

`bda5cef7` (DIOGO SCHMITZ): o corpo diz *"...porém o desfecho adequado é **monitoramento reforçado**, dado o vínculo PEP ativo"* — um comentário de raciocínio do próprio LLM sobre o que SERIA adequado, mas a decisão final (cabeçalho e fechamento) é "APROVADO". O check `/MONITORAMENTO\s+REFOR/` (que vem antes do check de "APROVA") capturou essa menção incidental.

**Vulnerabilidade análoga no lado ANALISTA:** `decisaoFromTextoAnalista()` (`src/data/registration-enrich.ts`), usada por `getDecisaoIA()` para badges/filtros da fila CHECK_ANALISTA, tinha:
```ts
if (/MONITORAMENTO\s+REFOR/.test(t) || t.includes("MONITORAMENTO")) return "monitoramento";
```
O `|| t.includes("MONITORAMENTO")` é um fallback solto que **anula** o regex mais preciso logo antes dele — captura qualquer menção à palavra "monitoramento" em qualquer contexto. Caso real encontrado na auditoria: draft `036e1466-b65e-4942-be21-e92d4d257b47` (PRIME PEÇAS E SERVIÇOS LTDA, CHECK_ANALISTA, vivo) — frase final do parecer diz *"sugerindo a **APROVAÇÃO** do cadastro, com recomendação de que os dados do PEP sejam complementados oportunamente para fins de **monitoramento contínuo**"* — a expressão "monitoramento contínuo" (recomendação de acompanhamento cadastral, não a categoria PLD "Monitoramento Reforçado") disparava o fallback solto, classificando como monitoramento quando a decisão real é APROVAÇÃO.

Mesma causa raiz nos dois lados (Python/Liderança e TypeScript/Analista): **busca de palavra-chave no texto inteiro em vez de na porção estruturalmente designada para a decisão** (a linha `Decisão:` no template de Liderança; a frase final no template de Analista, por instrução explícita do próprio SYSTEM_PROMPT — "3ª frase: recomendação fundamentada").

---

## Fix

### `detect_decisao()` (Python, `.tools/generate-sugestao-lideranca.py`)

Agora extrai especificamente a linha que começa com `Decisão:`/`Decisao:` e busca as palavras-chave só nela; só cai no texto inteiro se essa linha não existir (defensivo, não deveria acontecer dado o template).

### `decisaoFromTextoAnalista()` (TypeScript, `src/data/registration-enrich.ts`)

Agora extrai a última frase do texto (`text.split(/(?<=[.!?])\s+/)`, pega o último elemento) e busca as palavras-chave só nela. Removido o fallback solto `|| t.includes("MONITORAMENTO")` — o regex `/MONITORAMENTO\s+REFOR/` já é suficiente e correto, dado que o SYSTEM_PROMPT sempre termina com "MONITORAMENTO REFORÇADO" por extenso.

### Correção retroativa dos dados (sem chamar o LLM de novo)

Como o **texto** gerado sempre esteve correto — só a extração da `decisao`/`resumo` estruturada estava errada — a correção foi puramente de dados: recalculado `decisao` (via `detect_decisao()` corrigido) e `resumo` (via `_gerar_resumo(texto, nova_decisao)`) para as 2 entradas divergentes em `pareceres-lideranca.json`, preservando o texto original. Backup antes da alteração (`.tools/backups/pareceres/pareceres-lideranca.json.pre-detect-decisao-fix-*.backup`). O lado ANALISTA não persiste `decisao` (é derivada ao vivo pelo frontend via `getDecisaoIA`/`decisaoFromTextoAnalista`), então o fix do `.ts` já corrige `036e1466` automaticamente no próximo build, sem precisar de correção de dados.

---

## Verificação

- Reauditoria de `pareceres-lideranca.json` (28 entradas) com `detect_decisao()` corrigido: **0 divergências restantes** (eram 2).
- Reauditoria de todas as 81 sugestões CHECK_ANALISTA vivas com `decisaoFromTextoAnalista()` corrigido: **apenas o caso conhecido (`036e1466`) muda** — nenhuma regressão nos outros 80.
- `python3 -m py_compile` — OK. `npm run build` — OK, sem erros de TypeScript.
- Bundle novo verificado: 96/96 `draft_id` presentes; resumo corrigido de `1a38bc16` ("APROVAR com Diligência Reforçada — ...") confirmado no bundle via grep.
- Servidor reiniciado e saudável.

---

## Lições aprendidas

| Lição | Ação |
|-------|------|
| Extrair um campo estruturado (decisão) de texto livre por busca de palavra-chave no corpo inteiro é frágil — qualquer menção incidental da mesma palavra em outro sentido sequestra o resultado | Sempre restringir a busca à porção do texto estruturalmente designada para aquele campo (linha de cabeçalho, frase final por instrução do prompt) — nunca o texto inteiro |
| Um fallback "solto" (`||` sem qualificador) adicionado depois de um regex mais preciso pode anular a precisão que o regex foi feito para garantir | Ao revisar/adicionar uma condição de fallback, perguntar: "isso reintroduz o problema que a condição anterior corrigia?" |
| A mesma classe de bug apareceu de forma independente em Python (Liderança) e TypeScript (Analista) — não foi copy-paste do mesmo código, foi o mesmo padrão de raciocínio ruim aplicado duas vezes | Ao corrigir um bug de "busca ingênua em texto livre" numa função, procurar ativamente por funções irmãs no resto do código com a mesma forma de raciocínio, mesmo que a implementação seja diferente |
| O texto gerado pela IA estava sempre certo — só a extração estruturada (decisão/resumo) é que divergia. Um bug de "decisão errada" nem sempre significa que a IA raciocinou errado | Antes de reprocessar via LLM (caro, lento), verificar se o texto já existente está correto e o bug é só na camada de extração — corrigir só essa camada é mais barato e mais seguro |

---

## Owner & Follow-up

| Item | Responsável | Status |
|------|-------------|--------|
| `detect_decisao()` extrai só da linha "Decisão:" | Claude | ✅ Done |
| `decisaoFromTextoAnalista()` extrai só da última frase; remove fallback solto | Claude | ✅ Done |
| Correção retroativa de `decisao`/`resumo` em `pareceres-lideranca.json` (2 entradas) | Claude | ✅ Done |
| Considerar um check do Supervisor Agent: `decisao` armazenada vs. `detect_decisao(texto)` recalculada, para pegar futuras divergências automaticamente | Thay | ⏳ TODO (sugestão, não implementado nesta resposta — fora do escopo do pedido original) |

---

**Incidente fechado.**
