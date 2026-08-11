# Relatório de Incidente: Sugestão de Parecer IA ausente para casos novos

**Data:** 2026-08-06 (1ª ocorrência), 2026-08-10 (recorrência) e 2026-08-11 (3ª ocorrência, causa distinta)
**Severidade:** 🟠 ALTO (afeta insumo de decisão do analista/liderança)
**Status:** ✅ RESOLVIDO

---

## Resumo

Analistas reportaram casos novos chegando na fila (CHECK_ANALISTA e CHECK_LIDERANCA) sem a "Sugestão de parecer IA". O mesmo sintoma se repetiu duas vezes em 4 dias, por duas causas diferentes — ambas na mesma família de bug já registrada em [INCIDENT-REPORT-2026-07-13-4BUGS.md](INCIDENT-REPORT-2026-07-13-4BUGS.md) (Bug 1).

**Causa comum às duas ocorrências:** `pareceres-sugestao.json` e `pareceres-lideranca.json` são `import` estático em `src/data/registration-enrich.ts` — o Vite embute o conteúdo desses JSONs no bundle **em build-time**. Regenerar os arquivos-fonte no disco não é suficiente: sem um `npm run build` posterior, o app publicado continua servindo o snapshot antigo, e qualquer `draft_id` que não existia na última build simplesmente não tem sugestão para renderizar.

---

## Ocorrência 1 (2026-08-06) — Build manual esquecido

**Causa raiz:** o último `npm run build` datava de 27/jul, mas `registration-queue-real.json`, `pareceres-sugestao.json` e `pareceres-lideranca.json` haviam sido atualizados depois disso (05–06/ago). O bundle em produção (`index-BWZbOHOO.js`) não continha 36 dos 131 `draft_id` então vivos na fila (27%).

**Evidência:** varredura direta do bundle minificado confirmou a ausência literal dos IDs (`grep` do `draft_id` no `.js` servido).

**Fix:** `npm run build` + restart do serviço (`com.cora.pepito.server`, gerenciado por launchd). Bundle novo verificado com 131/131 IDs presentes.

---

## Ocorrência 2 (2026-08-10) — Pipeline automatizado sem rebuild

**Causa raiz:** o botão "Sincronizar Athena" da interface dispara `.tools/queue-sync.sh` (via `POST /api/queue/sync` em `server.cjs`). Em algum momento esse script ganhou uma etapa `[4/4]` de geração de sugestões IA (Liderança + Analista, via LiteLLM) — mas, diferente do script irmão `refresh-daily.sh` (que já havia sido corrigido no Bug 1 do incidente de 13/07), **nunca ganhou o passo `npm run build`**. Resultado: toda sincronização pelo botão gerava as sugestões corretamente nos arquivos-fonte, mas nunca reconstruía o bundle — a lacuna crescia a cada sync.

Ao investigar, 26/41 casos CHECK_LIDERANCA (63%) e 9/60 CHECK_ANALISTA estavam sem qualquer entrada nos JSONs de sugestão (não só ausentes do bundle — a geração em si também estava atrasada, pois o script de sync mais recente ainda estava em execução no momento da investigação).

Comentários em `queue-sync.sh` e no endpoint `/api/queue/sync` (server.cjs) diziam explicitamente "sem AI, sem rebuild" — desatualizados desde que a geração de IA foi adicionada, o que ajudou a mascarar o problema.

**Fix:**
- `.tools/queue-sync.sh`: novo passo `[5/5]` roda `npm run build` ao final do pipeline, no mesmo ponto em que `refresh-daily.sh` já fazia (mesmo texto de aviso, para consistência).
- Comentários corrigidos em `queue-sync.sh` (cabeçalho) e `server.cjs:313` (rota `/api/queue/sync`) para refletir o comportamento real (inclui AI + rebuild).
- Aguardada a sincronização em andamento terminar; rodado `npm run build` + restart manual para a leva de casos já gerada (o processo em execução no momento do fix carregou a versão antiga do script em memória e não pegou a correção).

**Arquivos:** `.tools/queue-sync.sh`, `server.cjs`

---

## Verificação (ocorrências 1 e 2)

- `bash -n .tools/queue-sync.sh` — sintaxe OK.
- Cobertura de sugestão nos JSONs-fonte: 101/101 casos vivos (60 CHECK_ANALISTA + 41 CHECK_LIDERANCA) com `text` (e `decisao` válida para Liderança).
- Bundle pós-build (`index-qf_VEUMh.js`) verificado via grep direto: 101/101 `draft_id` presentes.
- Servidor reiniciado (launchd `com.cora.pepito.server`), `index.html` aponta para o hash novo, `/api/queue` respondendo normalmente.

---

## Ocorrência 3 (2026-08-11) — `npm: command not found` no passo de rebuild

**Causa raiz:** o próprio fix da Ocorrência 2 (`npm run build` como passo `[5/5]` em `queue-sync.sh`) usava `npm` sem caminho absoluto. `queue-sync.sh` é executado por `server.cjs` via `child_process.spawn("/bin/bash", [QUEUE_SYNC_SH], { env: { ...process.env, PATH: "/bin:/usr/bin:/usr/local/bin:" + process.env.PATH } })` — um `PATH` hardcoded que nunca incluiu diretório algum com `node`/`npm` (nem Homebrew `/opt/homebrew/bin`, nem o Node portável do projeto em `.tools/node/bin/`, que **já existe e já tem `npm`** especificamente para não depender de instalação no sistema). Isso era invisível até então porque, antes da Ocorrência 2, `queue-sync.sh` nunca chamava `node`/`npm` — só Python.

Com `set -euo pipefail`, o `npm: command not found` (exit 127) abortou o script imediatamente nesse ponto, pulando inclusive o upload para GCS — mas os dois geradores de sugestão (`generate-sugestao-lideranca.py`/`generate-sugestao-parecer.py`, que têm fallback `|| echo` e por isso não abortam o script) já haviam rodado com sucesso antes disso. Ou seja: dados 100% corretos nos JSONs-fonte, bundle nunca reconstruído — sintoma idêntico ao das ocorrências 1 e 2, causa nova.

Validado que testar `npm run build` manualmente no terminal interativo (como fiz nas ocorrências 1 e 2) **mascara esse bug** — o shell interativo usa PATH do usuário (Homebrew em `/opt/homebrew/bin`), diferente do PATH minimalista que `server.cjs`/launchd realmente passam ao processo automatizado.

**Fix:** `export PATH="$ROOT/pepito-frontend/.tools/node/bin:$PATH"` no topo de `queue-sync.sh`, antes de qualquer chamada a `npm`. Aplicado preventivamente também em `refresh-daily.sh`, que tem o mesmo `npm run build` sem garantia de PATH (script hoje dormant — sem LaunchAgent `com.cora.pepito.refresh` carregado — mas com o mesmo defeito latente).

**Verificação:**
- Simulação do PATH exato do spawn (`env -i PATH="/bin:/usr/bin:/usr/local/bin" bash -c '...'`) confirma que `npm` resolve corretamente após o fix (`.tools/node/bin/npm`, v10.8.2).
- `bash -n` OK nos dois scripts.
- Dados: 81/81 casos vivos (62 CHECK_ANALISTA + 19 CHECK_LIDERANCA) com sugestão íntegra nos JSONs.
- Bundle pós-build (`index-C5sp2C_F.js`) verificado via grep direto: 81/81 `draft_id` presentes.
- Servidor reiniciado, `/api/queue` respondendo normalmente.

**Arquivos:** `.tools/queue-sync.sh`, `.tools/refresh-daily.sh`

---

## Lições aprendidas

| Lição | Ação |
|-------|------|
| Um fix aplicado em um script (`refresh-daily.sh`, Bug 1 de 13/07) não protege scripts irmãos com o mesmo padrão (`queue-sync.sh`) | Ao adicionar uma etapa de geração de dados a qualquer pipeline que alimenta `registration-enrich.ts`, revisar se o rebuild está incluso — não assumir que "é rápido, não precisa" |
| O Supervisor Agent já alertava "Build desatualizado" no Slack (07/ago e 10/ago) nas duas execuções do Full Guard | Alerta é passivo — ninguém agiu. Considerar ação automática (ex.: o próprio Supervisor disparar `npm run build` quando detectar builda desatualizado) em vez de só notificar |
| Comentários de código desatualizados ("sem AI, sem rebuild") mascararam o diagnóstico | Tratar comentário que descreve comportamento de pipeline como parte do contrato — atualizar no mesmo commit que altera o comportamento |
| Testar `npm run build` no terminal interativo não valida o fix — o PATH do shell do desenvolvedor é diferente do PATH que launchd/`server.cjs` realmente passam ao script automatizado | Ao corrigir um script disparado por `spawn`/launchd/cron, testar (ou pelo menos simular) o `PATH` real daquele contexto, não assumir que "funcionou no meu terminal" = "vai funcionar em produção" |
| Um fix novo adicionado a um script existente pode introduzir uma dependência (aqui, `npm`) que o `PATH` daquele contexto nunca precisou suportar antes | Ao adicionar QUALQUER chamada a um binário externo (`npm`, `node`, `npx`, etc.) num script de automação, usar caminho absoluto ou exportar PATH explicitamente — nunca assumir resolução via PATH ambiente |

---

## Owner & Follow-up

| Item | Responsável | Status |
|------|-------------|--------|
| Rebuild automático no `queue-sync.sh` | Claude | ✅ Done |
| Rebuild automático no `refresh-daily.sh` | Claude (13/07) | ✅ Done |
| PATH explícito para node/npm em `queue-sync.sh` e `refresh-daily.sh` | Claude (11/08) | ✅ Done |
| Ação automática a partir do alerta "Build desatualizado" do Supervisor | Thay | ⏳ TODO |
| Supervisor validar que o `queue-sync.sh`/`refresh-daily.sh` terminou com exit 0 (não só que os JSONs mudaram) | Thay | ⏳ TODO |

---

**Incidente fechado.**
