# Relatório de Incidente: sugestão de Liderança não gerada automaticamente + perda silenciosa em regeneração

**Data:** 2026-10-28
**Severidade:** 🔴 CRÍTICO (fila regulatória operando sem apoio de IA, sem alerta visível de causa raiz)
**Status:** ✅ RESOLVIDO

---

## Resumo

A Thay reportou, pela segunda vez em poucos dias, casos sem Sugestão IA na fila de Liderança — e
perguntou por que a geração não acontece automaticamente assim que um caso é derivado à Mesa. A
investigação encontrou **dois problemas distintos e sobrepostos**, ambos de causa raiz, não só mais
um backlog pontual para backfillar manualmente:

1. **Nenhum processo automático gera pareceres.** O único script que chama os geradores de sugestão
   (`queue-sync.sh`) só roda via clique manual no botão "Sincronizar Athena" — **não está no
   crontab**. O que está agendado (`full-guard-schedule.sh`, 6h e 14h) só roda Integrity Guard e
   Supervisor Agent, que **monitoram e alertam**, mas não geram nada. Ou seja: sem alguém clicar o
   botão (ou eu intervir manualmente, como nas duas vezes anteriores), a fila nunca se atualiza
   sozinha — isso explica por completo por que o problema "volta" repetidamente.
2. **Bug ativo em `generate-sugestao-lideranca.py`**: a cada execução, o script preservava **só**
   as entradas com `model` contendo `"manual"` e tratava **qualquer outra** (inclusive sugestões via
   LLM/Codex já corretas) como se precisasse ser regenerada do zero — reexpondo pareceres já prontos
   ao mesmo risco de falha (orçamento LiteLLM esgotado + Codex CLI instável sob pressão de memória)
   a cada ciclo, e **perdendo a entrada de vez** se a regeneração falhasse (a escrita incremental só
   grava o que está em `sugestoes`, que começava vazio para qualquer entrada não-manual). Esse bug
   já estava documentado como TODO pendente desde `INCIDENT-REPORT-2026-08-12-MANDATO-PEP.md` (Bug 3,
   item de follow-up "Thay ⏳ TODO") e nunca tinha sido corrigido.

No momento da investigação: fila CHECK_LIDERANCA com 14 casos, **13 sem sugestão** (só 1 preservado,
porque era o único com `model` contendo "manual" ou com texto sobrevivente de uma execução anterior
bem-sucedida); fila Analista com 14 casos novos também sem sugestão.

---

## Causa raiz #1 — `queue-sync.sh` nunca foi agendado

`server.cjs` só spawna `queue-sync.sh` em resposta a `POST /api/queue/sync` (clique humano no botão
da interface). O crontab do usuário só tem `full-guard-schedule.sh` (Integrity Guard + Supervisor,
2x/dia) — nenhuma entrada chama `queue-sync.sh`. Resultado: a cadeia completa (puxar Athena → sync
de comentário real → achados externos → **sugestão IA** → rebuild) só roda quando alguém lembra de
clicar, o que nas últimas semanas aconteceu com pouca frequência, deixando os dois geradores de
sugestão efetivamente inertes a maior parte do tempo.

**Fix:** adicionado ao crontab:

```cron
*/20 * * * * cd /Users/thay/Projetos\ Thay/pepito-frontend && NODE_ENV=development PYTHONUNBUFFERED=1 bash .tools/queue-sync.sh
```

A cada 20 minutos (não "instantâneo", mas ordens de grandeza mais frequente que "só quando alguém
lembra"). Escolhido 20 min porque o passo mais caro do pipeline (Athena/`build-real-queue.py`) é
barato mesmo rodando com frequência (consulta pequena, poucas centenas de linhas), e
`fetch-media-findings.py`/geradores de sugestão já são incrementais (só processam o que falta) — o
custo total de quota (JusBrasil, LLM) não muda com a frequência, só a LATÊNCIA até detectar e
processar um caso novo cai de "até 1 dia inteiro sem clique manual" para "até 20 minutos".

**Pré-requisito de segurança adicionado:** como o script passa a rodar sem supervisão humana e pode
se sobrepor a um clique manual do botão (ou a si mesmo, se uma execução demorar mais que o
intervalo), adicionado lock via `mkdir` atômico (`.tools/.queue-sync.lock/`, com PID gravado e
checado via `kill -0`) no topo de `queue-sync.sh` — uma segunda execução concorrente detecta o lock,
confirma que o PID dono ainda está vivo, e sai imediatamente (`[SKIP] ... já em execução`) em vez de
rodar em paralelo e arriscar escrita concorrente nos mesmos JSONs. `macOS` não tem `flock` por
padrão, por isso o uso de `mkdir` (atômico, portável) em vez disso.

**Arquivos:** crontab do usuário, `.tools/queue-sync.sh`, `.gitignore` (nova entrada pro diretório de
lock).

---

## Causa raiz #2 — regeneração completa em vez de incremental

`generate-sugestao-lideranca.py::main()` inicializava `sugestoes = {}` e só copiava de volta as
entradas com `"manual" in model` do arquivo existente — **todas as demais** (incluindo sugestões já
geradas corretamente por LLM/Codex em execuções anteriores) ficavam de fora da estrutura em memória
e eram tratadas como "preciso gerar" no loop principal. Konsequências:

- Toda execução tentava regenerar 100% dos casos não-manuais, não só os genuinamente faltantes —
  desperdício de chamadas de LLM/Codex e exposição desnecessária a falha.
- Pior: como a escrita em disco (`OUT_PATH.write_text(...)`) grava o dicionário `sugestoes`
  acumulado até aquele ponto a cada sucesso, uma entrada que JÁ EXISTIA e não foi regenerada com
  sucesso nesta execução (porque o Codex falhou, por exemplo) **desaparece do arquivo final** — não
  é só "não atualizada", é removida. Esse é o mecanismo exato que fazia a fila "regredir": um caso
  que tinha sugestão ontem podia aparecer sem sugestão hoje, sem nenhuma ação humana ter apagado nada.

`generate-sugestao-parecer.py` (irmão Analista) já tinha o padrão correto desde antes (carrega o
arquivo inteiro, preserva qualquer entrada com `text`, só gera para o que falta de verdade) — o bug
era exclusivo do gerador de Liderança.

**Fix:** `sugestoes = json.loads(OUT_PATH.read_text())` (carrega tudo), loop passa a pular qualquer
`did` cuja entrada já tenha `text` (preenchendo `resumo` se faltar), independente do valor de
`model`. Mesmo padrão agora nos dois scripts.

**Arquivos:** `.tools/generate-sugestao-lideranca.py`

---

## Verificação

- `python3 -c "import ast; ast.parse(...)"` nos dois scripts Python — sintaxe OK.
- `bash -n .tools/queue-sync.sh` — sintaxe OK.
- Lock testado isoladamente (duas invocações concorrentes de um script de teste equivalente): a
  segunda detecta o PID da primeira, imprime `[SKIP]`, sai sem rodar; lock removido corretamente ao
  final via `trap ... EXIT`.
- Backfill dos 14 casos Analista + 13 casos Liderança que estavam sem sugestão no momento do fix
  (via MCP Codex, orçamento LiteLLM confirmado ainda esgotado) — ver commit de dados correspondente.

---

## Lições aprendidas

| Lição | Ação |
|-------|------|
| Um script de automação existir não significa que ele está agendado — a suposição "deve estar rodando no cron" nunca foi conferida contra o crontab real | Antes de investigar "por que algo não aconteceu automaticamente", checar primeiro `crontab -l` — a causa mais simples (não está agendado) vence qualquer hipótese mais sofisticada |
| Um TODO documentado num incident report antigo (2026-08-12) ficou undefinitely pendente sem nenhum lembrete ativo | TODOs de bug conhecido e não-corrigido deveriam ter um trigger de revisão (ex.: o Supervisor Agent checar se o TODO ainda existe no código, não só confiar que alguém vai lembrar) |
| Rodar um script automaticamente com mais frequência, sem lock, é uma receita pra corrupção de escrita concorrente assim que ele deixa de ser "clique manual ocasional" | Sempre que um script manual vira agendado, revisar reentrância/concorrência como parte do mesmo fix, não depois |

---

## Owner & Follow-up

| Item | Responsável | Status |
|------|-------------|--------|
| `queue-sync.sh` agendado a cada 20 min via cron | Claude | ✅ Done |
| Lock (`mkdir` atômico) em `queue-sync.sh` | Claude | ✅ Done |
| Fix de regeneração incremental em `generate-sugestao-lideranca.py` | Claude | ✅ Done |
| Backfill dos 27 casos sem sugestão (14 Analista + 13 Liderança) | Claude | ✅ Done |
| Considerar expor no Dashboard/Supervisor um alerta explícito "queue-sync não roda há mais de N horas" (hoje o Supervisor alerta sobre cobertura de sugestão, mas não sobre o próprio agendamento estar ausente) | Thay | ⏳ TODO (fora do escopo deste fix) |

---

**Incidente fechado.**
