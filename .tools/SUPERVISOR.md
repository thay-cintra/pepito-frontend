# Supervisor Agent — Documentação técnica

## Visão geral

O **Supervisor Agent** é um sistema de monitoramento automatizado que executa diárias (ou sob demanda) para verificar a saúde da aplicação Pepito, detectar anomalias e alertar o time via Slack com priorização por risco.

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  Cron / API Trigger                                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  .tools/supervisor-schedule.sh                          │
│  (carrega .env, ativa venv, executa agente)             │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  .tools/supervisor-agent.py                             │
│  SupervisorAgent class:                                 │
│    - check_servidor_node()                              │
│    - check_api_queue()                                  │
│    - check_arquivo_build()                              │
│    - check_analises_salvas()                            │
│    - check_registration_queue_real()                    │
│    - check_git_status()                                 │
│    - check_typescript_errors()                          │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────┴──────────┐
        ▼                   ▼
  ┌──────────────┐    ┌──────────────────┐
  │ Slack Webhook│    │ JSON Report      │
  │ (alertas)    │    │ (histórico)      │
  └──────────────┘    └──────────────────┘
```

## Verificações detalhadas

### 1. `check_servidor_node()` — 🔴 MUITO ALTO

**O quê:** Testa conectividade HTTPS na porta 4173

**Como:** `curl -s -k https://192-168-201-67.sslip.io:4173`

**Falha se:**
- Status HTTP ≠ 200
- Resposta não contém `<!doctype`
- Timeout > 5s

**Ação:** Se falhar → alerta MUITO ALTO "Servidor Node não responde"

**Exemplo de falha:**
```
curl: (7) Failed to connect to 192-168-201-67.sslip.io port 4173: Connection refused
```

---

### 2. `check_api_queue()` — 🟠 ALTO

**O quê:** Valida `/api/queue` retorna JSON com fila PLD

**Como:** Faz request a `/api/queue`, parseia JSON, verifica campo `_meta.total`

**Falha se:**
- Endpoint indisponível (HTTP ≠ 200)
- JSON inválido
- Campo `items` não é array
- `total` = 0 (fila vazia) → aviso MÉDIO

**Ação:** Se falhar → alerta ALTO

**Exemplo de falha:**
```json
// Esperado:
{
  "_meta": {
    "total": 61,
    "by_bucket": {"CHECK_LIDERANCA": 26, "CHECK_ANALISTA": 35}
  },
  "items": [...]
}

// Obtido:
{"error": "Não autenticado"}
```

---

### 3. `check_arquivo_build()` — 🔴 MUITO ALTO

**O quê:** Verifica se `dist/index.html` existe e foi buildado recentemente

**Como:**
- Verifica existência de arquivo
- Compara `mtime` com now — alerta se > 24h

**Falha se:**
- Arquivo não existe
- Build desatualizado (> 24h) → aviso MÉDIO

**Ação:** Se não existir → alerta MUITO ALTO

**Casos:**
```
✓ dist/index.html (buildado agora) — OK
✓ dist/index.html (buildado há 12h) — OK
⚠ dist/index.html (buildado há 30h) — Aviso MÉDIO
✗ dist/ não existe — Alerta MUITO ALTO
```

---

### 4. `check_analises_salvas()` — 🟠 ALTO

**O quê:** Valida `src/data/analises-salvas.json` — persistência de análises

**Como:**
- Lê arquivo JSON
- Valida estrutura (`analises` é array)
- Verifica tamanho (> 100MB → aviso MÉDIO)

**Falha se:**
- Arquivo não existe → alerta ALTO
- JSON corrompido → alerta MUITO ALTO
- Tamanho > 100MB → aviso MÉDIO

**Exemplo:**
```json
{
  "_meta": {
    "ultima_atualizacao": "2026-07-01T10:00:00.000Z",
    "total_analises": 52
  },
  "analises": [...]  // ← deve ser array
}
```

---

### 5. `check_registration_queue_real()` — 🔴 MUITO ALTO

**O quê:** Valida `src/data/registration-queue-real.json` — snapshot da fila Athena

**Como:**
- Lê arquivo JSON
- Valida estrutura (`items` é array)
- Conta total de casos

**Falha se:**
- Arquivo não existe → alerta MUITO ALTO
- JSON corrompido → alerta MUITO ALTO
- `items` não é array → alerta MUITO ALTO
- Array vazio → aviso MÉDIO

**Exemplo:**
```json
{
  "_meta": {
    "fetched_at": "2026-07-01T10:00:00Z",
    "total": 61,
    "by_bucket": {"CHECK_LIDERANCA": 26, "CHECK_ANALISTA": 35}
  },
  "items": [...]  // ← deve ser array com ≥ 1 item
}
```

---

### 6. `check_git_status()` — 🔵 BAIXO

**O quê:** Verifica se há mudanças não commitadas

**Como:** `git status --porcelain`

**Falha se:**
- Há mudanças staged ou não-staged (outputs não vazio)
- `git` command falha

**Ação:** Se houver mudanças → aviso BAIXO (não é bloqueador)

**Exemplo:**
```
 M src/lib/storage.ts      # modified
?? novo-arquivo.txt       # untracked
```

---

### 7. `check_typescript_errors()` — 🟠 ALTO (Opcional)

**O quê:** Executa `npm run typecheck` para detectar erros de tipo

**Como:** `npm typecheck` (tsc --noEmit)

**Falha se:**
- Exit code ≠ 0 (há erros)
- Timeout > 30s

**Ação:** Se falhar → alerta ALTO

**Nota:** Comentado por padrão para não bloquear se npm não estiver disponível.

---

## Níveis de alerta e ação

| Nível | Emoji | Descrição | Ação sugerida |
|---|---|---|---|
| MUITO ALTO | 🔴 | Aplicação down, dados perdidos | **Investigar imediatamente** — pode bloquear análises |
| ALTO | 🟠 | Funcionalidade crítica quebrada | **Investigar hoje** — afeta fluxo PLD |
| MÉDIO | 🟡 | Bug, inconsistência, degradação | **Tomar nota** — pode evoluir |
| BAIXO | 🔵 | Sugestão, housekeeping, warning | **Opcional** — não afeta usuário final |

---

## Integração Slack

### Webhook URL

Configurar variável de ambiente `.env`:
```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../...
```

### Formato de mensagem

```
┌─────────────────────────────────────────────┐
│ 🔍 Relatório Supervisor — Pepito            │
├─────────────────────────────────────────────┤
│ Horário: 2026-07-01T10:35:53Z               │
│ Verificações: 6 | Falhadas: 0               │
├─────────────────────────────────────────────┤
│ 🔴 MUITO ALTO (0)                            │
│ 🟠 ALTO (0)                                   │
│ 🟡 MÉDIO (0)                                  │
│ 🔵 BAIXO (1)                                  │
│ • Git Repository: Mudanças não commitadas    │
│   2 arquivo(s) modificado(s) sem commit.    │
└─────────────────────────────────────────────┘
```

### Quando enviar

- **Se há alertas:** Sempre envia (grouped por nível)
- **Se sem alertas:** Não envia (silent pass)
- **Erro de envio:** Log local (não bloqueia)

---

## Execução

### Via cron (diário)

```bash
# Adicionar ao crontab:
0 6 * * * /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor-schedule.sh

# Verifica próximas execuções:
crontab -l

# Vê log de execuções:
tail -f /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor.log
```

### Via API (manual)

```bash
# GET status atual + último relatório
curl https://192-168-201-67.sslip.io:4173/api/supervisor/status

# POST dispara execução
curl -X POST https://192-168-201-67.sslip.io:4173/api/supervisor/run
```

### Via CLI (desenvolvimento)

```bash
cd /Users/thay/Projetos\ Thay/pepito-frontend
python3 .tools/supervisor-agent.py
```

---

## Relatório JSON

Resultado salvo em `.tools/supervisor-last-report.json`:

```json
{
  "timestamp": "2026-07-01T10:35:53.122995",
  "checks_executados": 7,
  "checks_falhados": 0,
  "alertas": [
    {
      "nivel": "🔵 BAIXO",
      "titulo": "Mudanças não commitadas",
      "descricao": "2 arquivo(s) modificado(s) sem commit.",
      "componente": "Git Repository",
      "timestamp": "2026-07-01T10:35:53.122995"
    }
  ]
}
```

**Campos:**
- `timestamp` — Quando a verificação rodou
- `checks_executados` — Total de verificações tentadas
- `checks_falhados` — Quantas falharam completamente
- `alertas` — Lista de alertas (vazio = tudo OK)

---

## Troubleshooting

### "Erro ao enviar para Slack: SSLCertVerificationError"

**Causa:** Em LOCAL_MODE com certificados self-signed

**Solução:** Usar webhook em produção com certificados válidos, ou:
```python
import urllib3
urllib3.disable_warnings()  # Desabilita warning (não recomendado em prod)
```

### "Supervisor já em andamento"

**Causa:** Outra execução ainda está rodando

**Solução:** Aguarde 5-10 minutos, ou reinicie servidor

### "Webhook URL não configurada"

**Causa:** `SLACK_WEBHOOK_URL` não está em `.env`

**Solução:** Adicionar variável `.env` e recarregar

### "Arquivo não encontrado"

**Causa:** Caminhos relativos estão incorretos

**Solução:** Verificar que script está rodando com `cwd` correto:
```bash
cd /Users/thay/Projetos\ Thay/pepito-frontend && python3 .tools/supervisor-agent.py
```

---

## Extensões futuras

Possíveis adições ao supervisor:

1. **Performance metrics:** Tempo de resposta da API, tamanho do bundle
2. **Análise de logs:** Buscar stack traces em `.tools/supervisor.log`
3. **Comparação temporal:** Alertar se métrica piorou vs ontem
4. **Notificação push:** Além de Slack, enviar para PagerDuty/Opsgenie
5. **Custom checks:** Plugin system para verificações do domínio
6. **Dashboard:** UI para histórico de alertas (últimos 30 dias)

---

## Referências

- **Supervisor Agent:** `.tools/supervisor-agent.py`
- **Scheduler:** `.tools/supervisor-schedule.sh`
- **Endpoints API:** `server.cjs` linhas ~383-437
- **Documentação README:** `README.md` seção "Supervisor Agent"
