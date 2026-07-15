# Supervisor Agent — Guia de Setup

## 1. Configuração rápida (5 minutos)

### Adicionar Webhook do Slack

1. Acesse: https://api.slack.com/apps
2. Clique em **Create New App** → **From Scratch**
3. Nome: "Pepito Supervisor" | Workspace: escolha o seu
4. Na sidebar: **Incoming Webhooks** → ON
5. **Add New Webhook to Workspace** → selecione canal (ex: #alerts)
6. Copie a URL completa (começa com `https://hooks.slack.com/...`)

### Configurar no `.env`

**Use a chave dedicada, não `SLACK_WEBHOOK_URL` genérica** — o `.env` raiz do
monorepo repete essa chave para vários projetos (midiamonitor_pld, Morning
Call PLD, Giro PCC/CV), e `python-dotenv` fica com o último valor do arquivo.
Usar a genérica já mandou o relatório do Supervisor para o canal errado
(#midias-adversas) em vez de #pepito-supervisor. Ver detalhes em
[SUPERVISOR.md](./SUPERVISOR.md#integração-slack).

```bash
# Adicionar ao arquivo .env na RAIZ DO MONOREPO (não no .env do pepito-frontend):
SLACK_WEBHOOK_URL_PEPITO_SUPERVISOR=https://hooks.slack.com/services/T.../B.../IqlW4xFDY472DGHXqN0Eji5B
```

Salve e recarregue o servidor:
```bash
# Restart local
pkill -f "node server.cjs"
cd /Users/thay/Projetos\ Thay/pepito-frontend
LOCAL_MODE=true NODE_ENV=development PORT=4173 node server.cjs &
```

---

## 2. Testar manualmente (imediato)

### Opção A: CLI

```bash
cd /Users/thay/Projetos\ Thay/pepito-frontend
python3 .tools/supervisor-agent.py
```

**Esperado:**
```
============================================================
SUPERVISOR AGENT — 2026-07-01T10:35:53.122995
============================================================

[Verificações executadas...]

============================================================
SUMÁRIO: 6 verificações
Falhadas: 0
Alertas: 1
============================================================

✓ Alertas enviados para Slack (1 alertas)
✓ Relatório salvo em: .tools/supervisor-last-report.json
```

### Opção B: API HTTP

```bash
# Disparar verificação
curl -X POST https://192-168-201-67.sslip.io:4173/api/supervisor/run

# Ver status
curl https://192-168-201-67.sslip.io:4173/api/supervisor/status
```

### Opção C: Dashboard (após implementar UI)

- Menu → Supervisão
- Botão "Executar verificação agora"
- Ver alertas em tempo real

---

## 3. Agendar execução diária (cron)

```bash
# Abrir editor de cron
crontab -e

# Adicionar linha (executa às 6h todo dia):
0 6 * * * /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor-schedule.sh

# Ou para testar: a cada 5 minutos
*/5 * * * * /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor-schedule.sh
```

### Ver próximas execuções
```bash
crontab -l
```

### Ver log de execuções
```bash
# Último resultado
tail -20 /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor.log

# Em tempo real
tail -f /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor.log
```

---

## 4. Verificar alertas no Slack

### Formato esperado

Cada alerta aparece como um bloco formatado:

```
🔍 Relatório Supervisor — Pepito
Horário: 2026-07-01T10:35:53Z
Verificações: 6 | Falhadas: 0

🔴 MUITO ALTO (0)
🟠 ALTO (0)
🟡 MÉDIO (0)
🔵 BAIXO (1)
  • Git Repository: Mudanças não commitadas
    2 arquivo(s) modificado(s) sem commit.
```

### Desabilitar alertas BAIXO (opcional)

Se ficar poluindo o Slack, editar `supervisor-agent.py`:
```python
# Comentar alerta BAIXO antes de enviar
if nivel == "🔵 BAIXO":
    continue  # Pula alertas baixos
```

---

## 5. Dashboards & Extensões

### Próximas melhorias sugeridas

- [ ] Dashboard de histórico (últimos 30 dias)
- [ ] Gráfico de tendências (alertas/dia)
- [ ] Notificação PagerDuty (críticos)
- [ ] Email digest (semanal)
- [ ] Custom checks (por domínio)

---

## 6. Troubleshooting

### "Webhook URL inválida"

```bash
# Verificar que a URL está correta (variável DEDICADA, não a genérica)
echo $SLACK_WEBHOOK_URL_PEPITO_SUPERVISOR
# Deve começar com: https://hooks.slack.com/services/
```

### "Supervisor já em andamento"

```bash
# Aguardar 5-10 min, ou forçar parada
pkill -f supervisor-agent.py
# Depois rodá-lo novamente
python3 .tools/supervisor-agent.py
```

### "Certificado SSL inválido" (LOCAL_MODE)

Esperado em desenvolvimento. Em produção usará certificados válidos.

### Não recebe mensagens no Slack

1. Verificar webhook URL está correta
2. Confirmar que há alertas (`supervisor-last-report.json`)
3. Verificar permissões do webhook (deve enviar para o canal)
4. Ver logs: `tail -f .tools/supervisor.log`

---

## 7. API Reference Rápida

### Endpoints

```bash
# Status atual + último relatório
GET /api/supervisor/status
Authorization: Bearer <token>

# Dispara verificação (async)
POST /api/supervisor/run
Authorization: Bearer <token>
Resposta: {"ok": true, "message": "Supervisor iniciado."}
```

### Arquivo de Relatório

```
.tools/supervisor-last-report.json
```

Contém:
- `timestamp` — quando rodou
- `checks_executados` — total de verificações
- `checks_falhados` — quantas falharam
- `alertas[]` — lista de alertas com nível/componente/descrição

---

## 8. Próximos passos

1. **Agora:** Teste manual via CLI
2. **Depois:** Configure Slack webhook e teste API
3. **Finalmente:** Agende cron job para execução diária
4. **Monitore:** Acompanhe alertas no Slack por 1 semana

---

## Referências

- **Documentação completa:** `.tools/SUPERVISOR.md`
- **Código:** `.tools/supervisor-agent.py`
- **README:** `README.md` (seção "Supervisor Agent")
