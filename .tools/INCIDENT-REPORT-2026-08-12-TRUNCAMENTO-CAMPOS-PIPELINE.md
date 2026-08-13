# Relatório de Incidente: Truncamento por caractere de campos JSON do pipeline escondia achados reais (mídia e processos) da Sugestão IA — Analista e Liderança

**Data:** 2026-08-12
**Severidade:** 🔴 MUITO ALTO (Sugestão IA declarava "nada identificado" com condenação real e agregado de 38 mídias desabonadoras ocultos)
**Status:** ✅ RESOLVIDO

---

## Resumo

A pedido do analista, verifiquei se o fix aplicado em `INCIDENT-REPORT-2026-08-12-TRUNCAMENTO-PARECER-ANALISTA.md` (peso do parecer da analista / truncamento em 600 chars) também tinha sido feito na fila do Analista (`generate-sugestao-parecer.py`). Não tinha — e a auditoria revelou um bug irmão, mais grave e mais amplo: os campos `pj_midianegativas`/`pf_midianegativas`/`processosjudiciais_pj`/`processosjudiciais_pf` (JSON estruturado vindo do pipeline Credilink/midiamonitor, usados nos **dois** geradores) eram truncados por caractere (`[:80]` no Analista, `[:120]` na Liderança) — cortando o JSON no meio e escondendo achados reais.

---

## Achados reais que estavam invisíveis

| Draft | Titular/PEP | O que estava escondido | Verificação |
|---|---|---|---|
| `5397f71c` (MAESTRO ATACADISTA) | PEP Carla Suzi Emerenciano (ex-Prefeita) | Notícia (G1) de **CONDENAÇÃO** por facilitar contratação de parente (nepotismo/improbidade) — match 100%, risco Alto | Achado direto pelo nome completo da PEP; JSON de 1979 chars cortado em 120 nunca chegava ao conteúdo |
| `3faa1650` (CASTELO BRANCO EMPREENDIMENTOS) | Titular Fábio Callado Castelo Branco | Agregado `"TipoMidia":"Desabonadora"` com **38 ocorrências**: Corrupção, Criminal, Prisão, Improbidade Administrativa | JSON compacto, mas ainda cortado antes do campo `Descricao` completo aparecer |
| `fe42d65d` (FESTAS PIC) | Titular (owner) | Agregado "Desabonadora" mencionando "homicídio", "Prisão", "crime" (Quantidade: 4) | Idem |
| `13ddfe7a` (MARCOS A DOS SANTOS) | PEP titular, ex-Vereador Alagoa Grande/PB | 3 notícias associando o nome a tráfico/liderança de facção (PCC) — mas **risco_homônimo MÉDIO** sinalizado pelo próprio pipeline (nome comum, fatos na Bahia/SC, sobrenomes compostos diferentes) | **Verificado via JusBrasil consulta pro** (CPF real): 0 processos criminais, 0 mandados — homônimo confirmado |
| `1a38bc16` (ESPACO LUGAR DE FALA, CHECK_LIDERANCA) | — | Notícia sobre a expressão política "lugar de fala" (match de frase genérica com o nome da empresa) | Falso positivo óbvio (frase comum, sem relação com a empresa) |

Total: **14 casos vivos** com achado real nesses campos (13 CHECK_ANALISTA + 1 CHECK_LIDERANCA), de um levantamento de 168 casos históricos onde os campos já haviam ultrapassado o limite de truncamento em pelo menos uma ocasião.

---

## Causa raiz

`_get_parecer_analista()` (corrigido no incidente anterior) só existe no gerador de Liderança, porque só ali há parecer de analista para ler. Mas os campos `pj_midianegativas`/`pf_midianegativas`/`processosjudiciais_pj`/`processosjudiciais_pf` vêm **direto da fila** (Credilink/midiamonitor) e são lidos nos **dois** geradores — e os dois tinham o mesmo padrão de truncamento cru:

```python
pj_midia = (case.get("pj_midianegativas") or "").replace('"', "").strip()
...
f"- Mídia adversa PJ/PF: {pj_midia[:80] or '(sem)'} / ..."   # Analista
f"- Mídia adversa PJ/PF: {pj_midia[:120] or '(sem)'} / ..."  # Liderança
```

Diferente do parecer da analista (texto livre), esses campos são **JSON estruturado** com pelo menos 4 formatos distintos (notícias com metadados de risco/confiança, agregado `TipoMidia`, agregado `QuantidadeTotal`, lista de processos). Truncar por caractere corta o JSON no meio, o que é ainda mais destrutivo que truncar texto livre — o LLM recebe fragmento de JSON ilegível ou nada além do cabeçalho (`{"consulta":...`), nunca o conteúdo (título da notícia, artigo do CP, status do processo).

**Escopo:** `pf_midianegativas` chega a 6607 caracteres de conteúdo real em casos vivos hoje; `processosjudiciais_pf` chega a 1275. Elevar o limite de caracteres não seria suficiente de forma robusta (não há garantia de que o achado mais relevante apareça primeiro no JSON) — a correção certa é **parsear o formato e extrair o que importa**, não truncar.

---

## Fix

### `_resumir_campo_pipeline(raw, max_itens=3)` — novo, duplicado nos dois scripts (mesmo padrão de helpers já usado no projeto)

Reconhece os 4 formatos observados e produz texto legível, priorizado por risco:

1. **`{"consulta":..., "noticias":[...]}`** (mídia negativa detalhada) — ordena notícias por `nivel_risco` (Alto > Médio > Baixo) e `confianca` decrescente; inclui até 3; preserva o alerta `risco_homonimo` do próprio pipeline quando presente (nível ≠ BAIXO).
2. **`{"TipoMidia":"Desabonadora", "Descricao":..., "Quantidade":N}`** (agregado simples) — retorna direto, sem truncar.
3. **`{"QuantidadeTotal":..., "Federal":..., ...}`** (agregado de processos) — concatena os campos não vazios.
4. **`[{"Numero":..., "Tribunal":..., "Assunto":..., "Status":...}, ...]`** (lista de processos) — prioriza processos ATIVOS e de natureza não cível/trabalhista sobre arquivados/civil/trabalhista (ver `feedback_processo_civil_trabalhista_nao_e_risco`); mostra até 3 + contagem do restante.
5. Fallback: JSON não mapeado ou texto livre → trunca em 800 chars (não em 80/120).

### Reforço nas regras de decisão (nos dois `SYSTEM_PROMPT`)

Nova regra: campo do pipeline preenchido com achado concreto **nunca** é "nada identificado" por padrão — deve ser citado explicitamente. Achado com `[risco homônimo ALTO/MEDIO: ...]` deve ser tratado como **não confirmado** (mencionar a suspeita, recomendar confirmação de identidade, **não** escalar automaticamente para REPROVAÇÃO). Achado nível "Alto" sem alerta de homônimo, citando Corrupção/Criminal/Prisão/Improbidade/Homicídio/Tráfico, é achado factual concreto.

### Regeneração

- Backup de `pareceres-sugestao.json`/`pareceres-lideranca.json` antes do fix (`.tools/backups/pareceres/*.pre-campos-pipeline-fix-*.backup`).
- CHECK_ANALISTA: removidas as 13 entradas afetadas vivas; reexecutado `generate-sugestao-parecer.py` — regenerou exatamente essas 13 (+ algumas novas por churn normal da fila), preservou o resto. Confirmado por diff direto contra o backup (não apenas pelo log do processo — ver nota abaixo).
- CHECK_LIDERANCA: minha primeira tentativa manual (rodar `generate-sugestao-lideranca.py` direto) **falhou silenciosamente para os 13 casos** por queda intermitente da VPN corporativa — o script imprimiu "13/13 gerados" no log, mas um diff byte-a-byte contra o backup pré-run provou que **nada tinha sido escrito** (o log mentiu; sempre confirmar por diff, não pelo texto do log). Já resolvido de outra forma: a sincronização real de produção (botão "Sincronizar Athena", 2026-08-13 09:47–09:49 local) rodou o script já corrigido (ele lê o `.py` do disco, não depende de commit) e regenerou as 15 CHECK_LIDERANCA vivas com sucesso — incluindo `1a38bc16`, que agora nomeia e descarta explicitamente o falso positivo ("lugar de fala").

**Resultados de destaque:**

| Draft | Antes | Depois |
|---|---|---|
| `5397f71c` (Carla Suzi Emerenciano) | "não foram identificadas mídias desabonadoras... sugerimos APROVAÇÃO" | Cita a condenação por nome, nota confiança 67% (não 100%), recomenda **REPROVAÇÃO salvo confirmação em contrário pelo analista** |
| `3faa1650` (Fábio Callado Castelo Branco) | "único processo... cível, sem caráter desabonador... APROVAÇÃO" | Cita as 38 ocorrências (Corrupção/Improbidade/Prisão) + processos ativos, conclui **REPROVAÇÃO** |
| `13ddfe7a` (Marcos Antônio dos Santos) | "não identificadas mídias... APROVAÇÃO" (by coincidência, mesmo resultado, mas sem nunca ter visto o achado) | Cita as notícias de tráfico, explica por que são homônimo (sobrenomes/estados diferentes), recomenda **APROVAÇÃO com descarte formal do homônimo pelo analista** — mesma conclusão, agora fundamentada e auditável |

---

## Verificação

- `python3 -m py_compile` — OK nos dois scripts.
- `_resumir_campo_pipeline` testado isoladamente contra os 4 casos mais críticos antes de rodar qualquer LLM — confirma extração correta dos 4 formatos.
- **Verificação externa via JusBrasil consulta pro** (não apenas confiar no texto): CPF de Marcos Antônio dos Santos — 0 processos criminais, 0 mandados, 0 MP — confirma homônimo.
- Interrupção por queda de VPN corporativa durante a execução (DNS de `*.cora.team` não resolvia) — trabalho de código todo validado offline antes da interrupção; regeneração de Liderança concluída depois via sincronização de produção (ver acima).
- Cobertura final: 96 casos vivos (81 CHECK_ANALISTA + 15 CHECK_LIDERANCA), 0 sem Sugestão IA, 0 ausentes do bundle publicado (verificado por grep de todos os `draft_id` contra `dist/assets/index-*.js`).
- `npm run build` (automático, via `queue-sync.sh`) — bundle `index-CTu6vvPk.js` (2026-08-13 09:49) contém 96/96 `draft_id`, incluindo o caso `038b2ffa` reportado pelo analista antes do rebuild.
- Servidor confirmado saudável via `localhost` e via hostname oficial (ver nota de rede abaixo).

### Nota operacional — hostname oficial ficou temporariamente inacessível (resolvido sozinho)

Durante a verificação pós-restart em 12/08, `https://192-168-201-67.sslip.io:4173` (URL oficial, ver `reference_pepito_url_oficial`) não respondeu, enquanto `https://localhost:4173` respondeu normalmente — o IP local da máquina havia mudado (`192.168.1.191`) após reconexão de VPN, diferente do IP fixo `192.168.201.67` embutido no hostname sslip.io. Servidor sempre esteve 100% saudável; só a rota até ele mudou. Em 13/08 (verificação deste incidente), a rota já estava normalizada — o IP local mudou de novo (`192.168.0.14`) mas o hostname oficial voltou a responder corretamente, confirmado por teste real (`curl` retornou o bundle correto). Não precisou de intervenção; registrado para referência caso reapareça.

---

## Lições aprendidas

| Lição | Ação |
|-------|------|
| Um truncamento "de segurança" pode ser ainda mais destrutivo em campos JSON estruturados do que em texto livre — corta a sintaxe, não só o conteúdo | Para qualquer campo estruturado (JSON/array/dict) usado num prompt de LLM, parsear e extrair por relevância — nunca truncar a string bruta por caractere |
| O pipeline já calcula sinais úteis (risco_homonimo, nivel_risco, confiança) que a IA nunca via porque o truncamento cortava antes de chegar neles | Ao integrar uma nova fonte de dado estruturada a um prompt, sempre checar se ela já tem metadados de qualidade/confiança embutidos e propagá-los, não descartar |
| "Mesmo resultado final" (caso Marcos: homônimo, aprovação nos dois cenários) não significa "sem bug" — a IA chegou lá sem nunca ter visto o achado, então a mesma classe de bug poderia ter dado o resultado errado em outro caso (e deu, nos casos Carla e Fábio) | Verificar causa raiz mesmo quando o desfecho parece correto por coincidência |
| Verificação externa (JusBrasil consulta pro) é mais confiável que confiar no texto ou descartar por completo | Sempre que houver achado com match parcial/inconclusivo e CPF disponível, verificar via API real antes de aceitar qualquer conclusão |
| O log de `generate-sugestao-lideranca.py` imprimiu "13/13 gerados" numa execução que na verdade falhou 100% (VPN instável) — o log mentiu, só o diff do arquivo contra o backup revelou a falha real | Nunca aceitar o resumo/print final de um script como prova de sucesso quando há I/O de rede envolvido; sempre confirmar por evidência direta (diff, timestamp, conteúdo) |
| O check de cobertura do Supervisor Agent só olhava o JSON-fonte, nunca o bundle publicado — por isso nunca detectou os gaps de "bundle desatualizado" que motivaram este incidente e o anterior | Ver seção "Caso adicional" abaixo — check corrigido para comparar contra o bundle |

---

## Caso adicional (2026-08-13) — draft 038b2ffa, e reforço do Supervisor

Novo caso reportado pelo analista: `038b2ffa-b624-4ab2-9fa6-8b9497a09e38` (PICOS KART CLUB ASSOCIACAO ESPORTIVA, CHECK_LIDERANCA) sem Sugestão IA visível.

**Diagnóstico:** não era um gap novo — o analista verificou antes da sincronização automática das 09:47–09:49 (horário local) do mesmo dia terminar. No momento da checagem (pouco depois), dado e bundle já estavam corretos: `pareceres-lideranca.json` tinha o texto (gerado 09:47 local) e o bundle (`index-CTu6vvPk.js`, buildado 09:49 local pelo próprio `queue-sync.sh` já com o fix de rebuild automático) já incluía o `draft_id`. Confirmado por `grep` direto no bundle e teste real via hostname oficial.

**Causa de fundo continuada:** o `check_cobertura_pareceres_sugestao()` do Supervisor Agent já existia (adicionado no incidente de 13/07), mas seu próprio docstring já dizia cobrir "bundle desatualizado" — e o código nunca fez isso, só comparava o JSON-fonte contra a fila. É exatamente o padrão de "guardrail documentado ≠ guardrail implementado" já registrado no incidente do mandato PEP.

**Fix:** `check_cobertura_pareceres_sugestao()` reescrito em `.tools/supervisor-agent.py` para verificar em duas etapas: (1) o JSON-fonte tem o texto? (como antes); (2) dos que têm, quantos estão de fato presentes no bundle mais recente (`dist/assets/index-*.js`, lido como texto e comparado por substring do `draft_id`)? Gap na etapa 2 gera alerta 🟠 ALTO próprio, distinto do gap de geração. Já roda como parte de `executar_todas_verificacoes()` — que já dispara 2x/dia (6h e 14h) via crontab + `full-guard-schedule.sh`, cumprindo "reportar diariamente" no canal `#pepito-supervisor` (`SLACK_WEBHOOK_URL_PEPITO_SUPERVISOR`, confirmado único e correto no `.env`).

**Verificação:** testado isoladamente contra o estado atual (0 gaps, nenhum alerta — esperado, pois tudo está sincronizado); lógica de comparação testada com um UUID inexistente para confirmar que detecta ausência corretamente; supervisor completo executado de ponta a ponta (10 verificações, 0 falhas, alertas legítimos não relacionados enviados normalmente ao Slack).

---

## Owner & Follow-up

| Item | Responsável | Status |
|------|-------------|--------|
| `_resumir_campo_pipeline` nos dois geradores | Claude | ✅ Done |
| Reforço de regra (homônimo / achado do pipeline) nos dois `SYSTEM_PROMPT` | Claude | ✅ Done |
| Regeneração dos 14 casos vivos afetados (concluída via sincronização de produção) | Claude | ✅ Done |
| Supervisor Agent: check de cobertura agora valida contra o bundle publicado, não só o JSON-fonte | Claude | ✅ Done |
| Verificar retroativamente casos históricos (não necessariamente vivos) que já passaram por esses campos truncados | Thay | ⏳ TODO |
| Considerar mover a comparação "check_arquivo_build" (só idade em horas) para usar a mesma lógica de comparação por draft_id | Thay | ⏳ TODO (melhoria, não bloqueante) |

---

**Incidente fechado.**
