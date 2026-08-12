# Relatório de Incidente: Truncamento do parecer da analista fazia a Sugestão IA de Liderança ignorar achados criminais reais

**Data:** 2026-08-12
**Severidade:** 🔴 MUITO ALTO (Sugestão IA recomendou desfecho oposto ao correto em caso com processo criminal ativo verificado)
**Status:** ✅ RESOLVIDO

---

## Resumo

A pedido do analista, investigação do caso `c0270b8a-36d2-4710-802f-9e17f3289cd5` (FILHOS DO REI MATERIAL DE CONSTRUCAO LTDA — titular Elson Neto de Araújo, irmão da PEP Suely Neto de Araujo Santos, Vereadora de Barra do Mendes/BA). A analista (M. Matos) recomendou **REPROVAÇÃO**, citando processo criminal ativo por tentativa de homicídio contra o titular. A Sugestão de Parecer IA (gerada e publicada no dia anterior, ver `INCIDENT-REPORT-2026-08-12-MANDATO-PEP.md`) **discordou da analista**, concluindo "os dados fornecidos não sustentam esse desfecho" e sugerindo apenas monitoramento reforçado.

Verificação independente via **JusBrasil consulta pro** (API real, não deep-link) confirmou que a analista estava certa — e o quadro real é pior do que ela relatou.

---

## Verificação factual (JusBrasil consulta pro)

CPF do titular (Elson Neto de Araújo, 156.585.465-91) consultado via `midiamonitor-pld/jusbrasil_client.py` (`query_criminal` — endpoint `/background-check/lawsuits/criminal`):

| Processo | Assunto | Polo passivo | Confiança | Status |
|---|---|---|---|---|
| 0001005-48.2015.8.05.0218 (TJBA) | **Homicídio Qualificado — Crime Tentado** (Art. 121 §2º CP) | Réu | **ALTA** | Ativo (última atualização 2026-06-18) |
| 8001398-84.2022.8.05.0218 | Injúria Preconceituosa (identidade de gênero) | Réu | ALTA | Ativo |
| 8000389-87.2022.8.05.0218 | Calúnia | Réu | ALTA | Ativo |
| 8000698-11.2022.8.05.0218 | Calúnia | Réu | ALTA | Ativo |
| 8000699-93.2022.8.05.0218 | Calúnia | Réu | ALTA | Ativo |
| 0600599-71.2024.6.05.0042 (TREBA) | Calúnia | Réu | ALTA | Ativo |
| 8000368-14.2022.8.05.0218 | Calúnia | Réu | ALTA | Arquivado |
| 0000027-95.2006.8.05.0021 | Ameaça / Lesão Corporal Grave | Réu | MÉDIA | Arquivado |
| 0600149-31.2024.6.05.0042 (TREBA) | Propaganda Eleitoral Extemporânea | Não é réu | ALTA | Arquivado |

**Conclusão da verificação:** o processo de tentativa de homicídio citado pela analista é **100% real e confirmado** (réu, confiança ALTA, ativo). Além disso, existem **5 processos adicionais ativos** de Calúnia/Injúria (crimes contra a honra) não mencionados nem pela analista nem pela Sugestão IA — o padrão de litigância criminal do titular é mais extenso do que qualquer uma das duas análises registrou. O processo específico de "difamação arquivada por decadência" (nº 8000554-75.2024.8.05.0021) citado pela analista não apareceu na consulta — pode ser gap de dados da base ou erro de transcrição do número; não afeta a conclusão, pois o processo de homicídio já é suficiente e está confirmado isoladamente.

Consumo de cota JusBrasil: 4 consultas (1 `screen_cpf` completo + 1 `query_criminal` isolado para lista não filtrada). Cota após uso: 264/325 (61 disponíveis).

---

## Causa raiz

**Não foi falha de raciocínio do LLM — foi perda de dados antes do prompt.** `_get_parecer_analista()` em `.tools/generate-sugestao-lideranca.py` truncava o comentário da analista em **600 caracteres**:

```python
return text[:600] + ("…" if len(text) > 600 else "")
```

O parecer da analista para este caso tem **1540 caracteres** e segue o padrão de escrita já documentado no próprio prompt (`vínculo + PEP + cargo` primeiro, **achados reputacionais depois**). O corte em 600 chars caiu literalmente no meio da palavra "desabonadores" — **removendo 100% do achado concreto** (número do processo, artigo do CP, tribunal, data) e entregando ao LLM só o preâmbulo sobre o vínculo PEP. Do ponto de vista do LLM, o parecer da analista genuinamente não continha nenhum achado — a conclusão "dados não sustentam reprovação" estava correta *dado o input truncado que ele recebeu*.

**Escopo do problema:** levantamento em `pareceres-real.json` mostrou que **54 de 168 (32%)** de todos os comentários `ENVIAR_LIDERANCA_PLD` já registrados excedem 600 caracteres — não é caso isolado, é um corte que atinge quase 1 em cada 3 pareceres de analista historicamente, silenciosamente, sem qualquer alerta.

---

## Fix

### 1. Remove o truncamento agressivo (`_get_parecer_analista`)

Limite elevado de 600/400 para **4000/2000** caracteres — folga generosa sobre o maior parecer real observado (1540 chars), sem risco de sobrecarregar o contexto do modelo (Claude Sonnet, janela de contexto ampla; o texto é sempre um único parágrafo escrito por humano, não um documento).

### 2. Reforço explícito no `SYSTEM_PROMPT` — peso do parecer da analista

Nova regra, inserida após a regra (2) REPROVADO:

> "PESO DO PARECER DO ANALISTA ... Se o parecer do analista citar um achado ESPECÍFICO E VERIFICÁVEL (número de processo, tribunal, artigo do Código Penal, data, natureza do crime), trate-o como achado factual concreto ... NUNCA escreva 'os dados fornecidos não sustentam esse desfecho' só porque os campos automatizados vieram vazios."

Isso é defesa em profundidade: mesmo que uma futura fonte de dado volte a chegar truncada ou incompleta por outro motivo, o modelo é instruído a não descartar uma citação específica só por falta de corroboração automatizada.

### 3. Regeneração de todos os casos CHECK_LIDERANCA vivos

`generate-sugestao-lideranca.py` regenera todas as entradas não-manuais a cada execução (comportamento pré-existente) — rodado após os dois fixes, cobrindo os 13 casos vivos no momento.

**Decisões que MUDARAM com o fix** (de 5 casos que tinham parecer >600 chars, truncados nas regenerações anteriores):

| Draft | Antes (truncado) | Depois (completo) | Avaliação |
|---|---|---|---|
| `c0270b8a` (Elson Neto de Araújo) | monitoramento | **reprovado** | Correto — processo de homicídio confirmado via JusBrasil |
| `be3d1ce2` (JR Locações) | monitoramento | **aprovado** | Correto — analista não relatou nenhum achado, mandato do PEP já encerrado |
| `75face72` (Recanto do Espeto) | monitoramento | **aprovado** | Correto — analista não relatou nenhum achado |
| `457e8162` (BFE Consultoria) | monitoramento | **aprovado** | Correto — analista não relatou nenhum achado, mandato encerrado há anos |
| `3b7c976f` (Claudiana Vieira Martins) | monitoramento | monitoramento (igual) | Sem mudança — empresa aberta durante o próprio mandato da PEP titular, fator agravante real |

Note que o truncamento causava erro **nos dois sentidos**: subestimava risco real (caso `c0270b8a`) e sobrestimava risco em casos limpos (3 casos indevidamente marcados para monitoramento reforçado quando a analista já tinha concluído aprovação simples sem ressalvas).

**Arquivos:** `.tools/generate-sugestao-lideranca.py`, `src/data/pareceres-lideranca.json`

---

## Verificação

- `python3 -m py_compile .tools/generate-sugestao-lideranca.py` — OK.
- Teste isolado do caso `c0270b8a` com o fix: `_get_parecer_analista` retorna os 1540 chars completos (antes: 600); LLM conclui `REPROVADO`, citando corretamente o número do processo, artigo do CP e tribunal, e menciona explicitamente que o achado vale "independentemente da ausência de retorno nos campos automatizados".
- Regeneração completa dos 13 casos CHECK_LIDERANCA vivos — 0 falhas, distribuição final: 10 reprovado, 9 monitoramento, 7 aprovado (33 pareceres no arquivo total, incluindo casos não mais na fila viva).
- Cobertura pós-fix: 99 casos vivos (86 CHECK_ANALISTA + 13 CHECK_LIDERANCA), 0 sem Sugestão IA.
- `npm run build` — OK. Bundle novo verificado via grep: `draft_id` do caso presente, texto "tentativa de homic[ídio]" e "CADASTRO REPROVADO" presentes.
- Servidor reiniciado, bundle novo no ar.

---

## Lições aprendidas

| Lição | Ação |
|-------|------|
| Um limite de truncamento "de segurança" (600 chars) cortava exatamente a parte que mais importa (o achado, que vem depois do preâmbulo no estilo de escrita adotado) | Nunca truncar texto humano decisório sem medir a distribuição real de tamanhos primeiro — o "limite de segurança" era menor que 32% dos casos reais |
| A IA "raciocinando errado" pode na verdade estar raciocinando corretamente sobre um input incompleto — o bug pode estar N passos antes do ponto onde o erro aparece | Antes de corrigir o prompt/regra de decisão, rastrear o dado de entrada até a fonte e confirmar que o LLM recebeu o que deveria receber (mesmo princípio de `root-cause-tracing` do systematic-debugging) |
| Achado citado pelo analista com número de processo específico é verificável — vale a pena verificar de fato (JusBrasil consulta pro), não só confiar ou só descartar | Estabelecer como prática: divergência entre Sugestão IA e parecer do analista em caso com citação específica = gatilho para verificação externa antes de aceitar qualquer um dos dois |
| O mesmo bug (truncamento) pode estar silenciosamente afetando dezenas de casos históricos sem gerar nenhum alerta — o Supervisor Agent não tem verificação de "input truncado" | Considerar um check de integridade: parecer do analista > N chars mas prompt enviado ao LLM menor que o parecer = sinal de truncamento silencioso |

---

## Owner & Follow-up

| Item | Responsável | Status |
|------|-------------|--------|
| Remove truncamento de 600/400 → 4000/2000 em `_get_parecer_analista` | Claude | ✅ Done |
| Regra "peso do parecer do analista" no SYSTEM_PROMPT | Claude | ✅ Done |
| Regeneração dos 13 casos CHECK_LIDERANCA vivos | Claude | ✅ Done |
| Verificar retroativamente os 54 casos históricos (não necessariamente vivos hoje) que já foram truncados, caso algum ainda esteja pendente de decisão | Thay | ⏳ TODO |
| Confirmar/corrigir o número do processo "8000554-75.2024.8.05.0021" citado pela analista (não localizado na consulta JusBrasil) | Thay/M. Matos | ⏳ TODO |
| Supervisor Agent: check de truncamento silencioso (parecer analista > limite enviado ao LLM) | Thay | ⏳ TODO |

---

**Incidente fechado.**
