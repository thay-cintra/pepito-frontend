# ✅ Slack Alertas — Configuração Completa

## Status: PRONTO PARA USAR

Sua integração Slack foi configurada com sucesso! 🎉

---

## O que foi feito

### 1. ✅ Webhook Slack configurado
- **Arquivo:** `/Users/thay/Projetos Thay/.env`
- **Variável:** `SLACK_WEBHOOK_URL=https://hooks.slack.com/...`
- **Status:** Ativo e testado

### 2. ✅ Supervisor Agent testado
- **Arquivo:** `.tools/supervisor-agent.py`
- **Teste:** Executado com sucesso
- **Resultado:** ✓ Mensagens chegam ao Slack
- **Última execução:** 2026-07-01 10:51:41

### 3. ✅ SSL corrigido para LOCAL_MODE
- **Arquivo:** `.tools/supervisor-agent.py` (linha 561)
- **Correção:** Desabilita verificação SSL em desenvolvimento
- **Resultado:** Funciona em ambiente local

### 4. ⏳ Cron agendado (manual)
- **Frequência:** 2x por dia (6h e 14h)
- **Instrução:** Veja abaixo como configurar

---

## Como ativar alertas diários

### Opção A: Adicionar manualmente ao crontab (recomendado)

```bash
# 1. Abra editor do crontab
crontab -e

# 2. Cole estas linhas no final (Ctrl+V ou Cmd+V)
CRON_TZ=America/Sao_Paulo

# Supervisor Agent — Monitoramento diário
0 6 * * * NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor-schedule.sh >> /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor.log 2>&1
0 14 * * * NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor-schedule.sh >> /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor.log 2>&1

# 3. Salve e saia (ESC → :wq → Enter)
```

**Resultado:** Supervisor rodará:
- 🕐 **6h da manhã** — verificação matinal
- 🕮 **14h da tarde** — verificação à tarde

### Opção B: Executar manualmente agora

```bash
cd /Users/thay/Projetos\ Thay/pepito-frontend
NODE_ENV=development python3 .tools/supervisor-agent.py
```

Verifique seu canal Slack para ver os alertas! 📬

---

## Exemplo de alerta no Slack

Quando há problemas, você receberá mensagens assim:

```
🔍 Relatório Supervisor — Pepito
Horário: 2026-07-01T10:51:41Z
Verificações: 6 | Falhadas: 0

🔴 MUITO ALTO (0)
🟠 ALTO (0)
🟡 MÉDIO (0)
🔵 BAIXO (1)
  • Git Repository: Mudanças não commitadas
    3 arquivo(s) modificado(s) sem commit.
```

---

## Logs & Monitoramento

### Ver execuções anteriores
```bash
tail -20 /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor.log
```

### Ver em tempo real (enquanto executa)
```bash
tail -f /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor.log
```

### Último relatório em JSON
```bash
cat /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor-last-report.json | python3 -m json.tool
```

---

## Verificar se cron está agendado

```bash
# Ver tarefas agendadas
crontab -l

# Procurar supervisor
crontab -l | grep -i supervisor
```

Esperado:
```
0 6 * * * NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor-schedule.sh
0 14 * * * NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor-schedule.sh
```

---

## Níveis de alerta explicados

| Emoji | Nível | Ação | Exemplo |
|-------|-------|------|---------|
| 🔴 | MUITO ALTO | Investigar **imediatamente** | Servidor down, dados perdidos |
| 🟠 | ALTO | Investigar **hoje** | API quebrada, funcionalidade offline |
| 🟡 | MÉDIO | Tomar nota | Bug menor, performance degradada |
| 🔵 | BAIXO | Opcional | Sugestão, housekeeping, warning |

---

## Troubleshooting

### ❓ Não recebo alertas?

**Checklist:**
- [ ] Webhook está em `.env`? → `grep SLACK_WEBHOOK /Users/thay/Projetos\ Thay/.env`
- [ ] Cron está agendado? → `crontab -l | grep supervisor`
- [ ] Há alertas para enviar? → Rode `python3 .tools/supervisor-agent.py`
- [ ] Webhook é válida? → Testa com curl ou Slack API

### ❓ Alertas MUITO ALTO não chegam?

Supervisor sempre envia MUITO ALTO mesmo se houver 0 alertas:
- ✅ Fila vazia → alerta MÉDIO
- ✅ Arquivo não existe → alerta MUITO ALTO
- ✅ Servidor offline → alerta MUITO ALTO

### ❓ Como testar a integração?

```bash
# Executa verificação agora
cd /Users/thay/Projetos\ Thay/pepito-frontend
NODE_ENV=development python3 .tools/supervisor-agent.py
```

Se mostrar "✓ Alertas enviados", chegou ao Slack! ✅

---

## Documentação relacionada

- **Supervisão completa:** `.tools/SUPERVISOR.md`
- **Setup rápido:** `.tools/SUPERVISOR-SETUP.md`
- **Incidente report:** `.tools/INCIDENT-REPORT.md`
- **Configuração Slack:** `.tools/SLACK-CONFIG.md`
- **README:** `README.md` seção "Supervisor Agent"

---

## Resumo executivo

| Item | Status | Detalhes |
|------|--------|----------|
| Webhook Slack | ✅ Configurado | URLs adicionadas ao `.env` |
| Envio de alertas | ✅ Testado | Mensagens chegam corretamente |
| SSL corrigido | ✅ Funcionando | LOCAL_MODE desabilita verificação |
| Agendamento | ⏳ Manual | Adicionar ao crontab manualmente |
| Monitoramento | ✅ Ativo | Logs salvos em `.tools/supervisor.log` |

---

**Próximo passo:** Adicione ao crontab e você receberá alertas diários no Slack! 🎉

**Dúvidas?** Verifique `.tools/SUPERVISOR.md` para documentação técnica completa.
