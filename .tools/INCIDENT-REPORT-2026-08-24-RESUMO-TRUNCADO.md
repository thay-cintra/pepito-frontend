# Relatório de Incidente: `resumo` do parecer de LIDERANÇA cortado no meio da palavra

**Data:** 2026-08-24
**Severidade:** 🟡 MÉDIO (conteúdo visível ao revisor fica com aparência de texto corrompido; a decisão em si não é afetada)
**Status:** ✅ RESOLVIDO (código); ⚠️ 3 entradas históricas `model=manual-*` continuam com o resumo truncado — não tocadas, ver Follow-up

---

## Resumo

Pedido do analista: "novo bug no parecer, verifique e corrija" — sem draft específico. Como as 6 sugestões de LIDERANÇA geradas no dia anterior (23/08) e as geradas hoje estavam todas com o campo `resumo` cortado abruptamente no meio de uma palavra ou número, sem "…", investiguei a função que gera esse campo.

**Exemplos reais (draft, campo `resumo` truncado):**
- `62697cbb`: "...e abriu a empresa em dezembro de 2023, durante o mandato **at**" (faltava "ativo")
- `46990f81`: "...A empresa, constituída em **201**" (faltava "2013")
- `4f0b1ab2` (versão anterior à regeneração de hoje): "...figura como investigado no Processo n.º 5208402-18.2025.8.13." (faltava ".0024)")

Esse `resumo` é exibido **sempre visível** (não é o "ver parecer completo" expansível) em [NovaAnalise.tsx:542](../src/pages/NovaAnalise.tsx#L542) — é a primeira impressão do parecer da IA para quem está revisando o caso.

---

## Causa raiz

`_gerar_resumo()` (`.tools/generate-sugestao-lideranca.py:72`) fazia `first = body[0][:280]` — corte bruto em 280 caracteres, sem olhar para fronteira de frase/palavra e sem indicar que o texto foi cortado (sem "…").

O lado TypeScript já tem a solução certa para o mesmo problema: `extrairResumoParecer()` (`src/data/registration-enrich.ts:120`) procura o primeiro `". "` dentro de uma janela razoável (20–200 chars) e só usa corte bruto (com "…" no final) como fallback. Essa função só é usada, porém, quando o JSON **não** tem `resumo` — e como `_gerar_resumo()` sempre preenche esse campo, o fallback bom do TypeScript nunca era acionado. Mesma classe de bug do incidente de 2026-08-13 (a mesma causa raiz aparece de forma independente em Python e TypeScript — aqui, a correção já existia de um lado só).

---

## Fix

### Código (`.tools/generate-sugestao-lideranca.py`)

`_gerar_resumo()` agora replica a lógica do `extrairResumoParecer()` (TS): corta no primeiro `". "` entre 20–200 chars; se não achar, corta em 180 chars; e só nesse caso de corte bruto adiciona "…". `py_compile` OK.

### Dados — correção retroativa (sem chamar o LLM)

Recalculado `resumo` (via `_gerar_resumo()` corrigido, a partir do `text` e `decisao` já armazenados) só para entradas que atendiam **as duas condições**:
1. `model` não começa com `manual-` (nunca tocar em revisão manual — convenção já estabelecida no próprio gerador);
2. `resumo` atual não termina em pontuação (`.`, `…`, `!`, `?`) — sinal de que foi cortado bruscamente pelo bug, não uma frase completa.

6 entradas atendiam as duas condições e foram corrigidas: `62697cbb`, `46990f81`, `fb02a9e4`, `59960e57`, `67e2d370`, `e17145a8`. Backup antes da alteração: `.tools/backups/pareceres/pareceres-lideranca.json.pre-resumo-truncado-fix-20260824_115730.backup`.

**Tentativa descartada:** a primeira versão do script de correção recalculou `resumo` para **todas** as 21 entradas, sem filtrar por `model`. Isso sobrescreveu resumos de pelo menos 8 entradas `manual-*` com um resumo mecânico pior (ex.: `70f186e7` tinha um resumo manual conciso — "Sócio direto de ex-Prefeito (carência PEP ativa); holding nova; sem desabonos confirmados." — e passou a "Empresa: KABRU PARTICIPACOES LTDA…", que é o início mecânico do parágrafo, não uma síntese). Revertido do backup antes de qualquer build/restart. Fix reaplicado só com o filtro `model != manual-*` acima.

---

## Achado adicional — NÃO corrigido (fora de escopo por convenção)

3 entradas `model=manual-*` (`2840b4e9`, `af5e8d1f`, `bda5cef7`) têm o **mesmo padrão** de corte no meio da palavra no campo `resumo` (ex.: `2840b4e9` termina em "...constitui ", `af5e8d1f` em "...Vara Crimin[al]"). Isso indica que a tag `model=manual-*` marca decisão **revisada por humano**, não necessariamente um `resumo` **escrito** por humano — o campo pode ter sido recomputado pela função antiga (com bug) num momento de correção manual da decisão. Mesmo assim, a convenção do próprio gerador é nunca regenerar automaticamente uma entrada `manual-*`, então não toquei nelas. Ficam registradas para o time de PLD decidir se vale corrigir manualmente.

---

## Verificação

- `py_compile generate-sugestao-lideranca.py` — OK.
- Diff campo-a-campo do JSON antes/depois do fix retroativo: só os 6 `resumo` esperados mudaram, nenhum outro campo em nenhuma entrada.
- Pipeline automático rodou de novo às 18:29–18:30 UTC (sync horário) e gerou 8 sugestões novas — todas com `resumo` bem formado (termina em pontuação), confirmando que a correção de código se sustenta em geração ao vivo, não só na correção retroativa pontual.
- `npx tsc --noEmit` e `npm run build` OK. Servidor reiniciado (`com.cora.pepito.server` via launchd, que respawna automaticamente ao `kill`) e confirmado servindo o bundle novo.

---

## Lições aprendidas

| Lição | Ação |
|-------|------|
| Um script de correção retroativa que recalcula um campo derivado para "todas as entradas" pode sobrescrever conteúdo bom (revisão manual) que só *parece* ter sido gerado pela função com bug | Sempre filtrar por uma condição verificável de "isso tem cara do bug" (aqui: não termina em pontuação) e por marcadores explícitos de proteção (`model=manual-*`) antes de escrever qualquer coisa; nunca aplicar em massa sem revisar o diff primeiro (dry-run antes de write) |
| Backup antes de escrever salvou o incidente de virar um segundo bug (perda de resumos manuais bons) | Manter o hábito de backup em `.tools/backups/pareceres/` antes de qualquer correção retroativa em massa, mesmo quando a lógica "parece" segura |
| `model=manual-*` protege contra regeneração automática, mas não garante que todo campo daquela entrada foi escrito por humano | Ao investigar dados rotulados como "manual", verificar campo a campo, não assumir que a tag cobre tudo |

---

## Owner & Follow-up

| Item | Responsável | Status |
|------|-------------|--------|
| `_gerar_resumo()` corta na fronteira de frase, nunca no meio da palavra | Claude | ✅ Done |
| Correção retroativa de `resumo` nas 6 entradas não-manuais afetadas | Claude | ✅ Done |
| Decidir se corrige manualmente o `resumo` das 3 entradas `manual-*` com o mesmo padrão de corte (`2840b4e9`, `af5e8d1f`, `bda5cef7`) | Thay | ⏳ TODO |

---

**Incidente fechado (código); achado adicional em dados `manual-*` fica como decisão do time de PLD.**
