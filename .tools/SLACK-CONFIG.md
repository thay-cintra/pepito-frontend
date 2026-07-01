# Configuração Slack para Supervisor Agent

Guia completo para integrar alertas do Supervisor com Slack.

---

## Passo 1: Acessar Slack API

1. Abra em seu navegador: **https://api.slack.com/apps**
2. Faça login com sua conta Slack (mesmo workspace da Cora)
3. Você verá a página "Your Apps"

---

## Passo 2: Criar novo aplicativo

### Opção A: Criar do zero (recomendado)

1. Clique no botão **"Create New App"** (no canto superior direito)
2. Escolha **"From Scratch"** (não "From an app manifest")
3. Preencha o formulário:

| Campo | Valor |
|-------|-------|
| **App Name** | `Pepito Supervisor` |
| **Workspace** | Selecione seu workspace Cora |

4. Clique em **"Create App"**

### Opção B: Criar via App Manifest

Se sua empresa usa manifests padrão, passe para o time de DevOps.

---

## Passo 3: Configurar Incoming Webhooks

Após criar o app, você será redirecionado para a página de configuração.

### 3.1 Ativar Incoming Webhooks

1. Na sidebar esquerda, procure por **"Incoming Webhooks"**
2. Clique em **"Incoming Webhooks"**
3. Mude o toggle para **"On"** (ativado)

Você deve ver: `Incoming Webhooks are enabled`

### 3.2 Adicionar webhook para canal

1. Clique em **"Add New Webhook to Workspace"** (botão azul grande)
2. Será solicitado que você escolha um canal:
   - Se quer alertas num canal **novo**: crie `#pepito-alerts` ou similar
   - Se quer num **canal existente**: selecione (ex: `#alerts`, `#incidents`)
3. Clique em **"Allow"** (vai pedir permissão)
4. Selecione o canal na dropdown
5. Clique em **"Allow"** novamente (confirmação final)

Você verá uma tela com a URL do webhook:

```
https://hooks.slack.com/services/T0A2H7V3L/B05M8X9K2/wR7j8Q4p2k9L3m5N6o8P9q
```

---

## Passo 4: Copiar URL do webhook

A URL completa aparece em um campo de texto (ou código):

```
Webhook URL
https://hooks.slack.com/services/T0A2H7V3L/B05M8X9K2/wR7j8Q4p2k9L3m5N6o8P9q
```

**Importante:** 
- ⚠️ Não compartilhe essa URL com outras pessoas
- ⚠️ Não faça commit dessa URL no Git
- ✅ Use apenas em variáveis de ambiente (`.env`)

---

## Passo 5: Adicionar ao `.env` do projeto

1. Abra o arquivo `/Users/thay/Projetos Thay/.env` (raiz do projeto, não a subpasta)

2. Procure por `SLACK_WEBHOOK_URL=` (se não existir, adicione no final)

3. Adicione/atualize com a URL copiada:

```bash
# Slack Webhook para Supervisor Agent
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T0A2H7V3L/B05M8X9K2/wR7j8Q4p2k9L3m5N6o8P9q
```

4. **Salve o arquivo** (Ctrl+S ou Cmd+S)

⚠️ **IMPORTANTE:** Nunca commit `.env` no Git — ele já deve estar em `.gitignore`

---

## Passo 6: Testar integração

### Teste 1: Via CLI (imediato)

```bash
cd /Users/thay/Projetos\ Thay/pepito-frontend
python3 .tools/supervisor-agent.py
```

Se tudo funcionar, você verá no final:
```
✓ Alertas enviados para Slack (1 alertas)
```

E a mensagem deve aparecer no seu canal Slack em **segundos**.

### Teste 2: Via API (se servidor está rodando)

```bash
# Dispara verificação
curl -X POST https://192-168-201-67.sslip.io:4173/api/supervisor/run

# Aguarde 5-10 segundos e veja a mensagem no Slack
```

### Teste 3: Enviar mensagem de teste manualmente

Se quiser testar o webhook **sem** rodar o supervisor:

```bash
curl -X POST https://hooks.slack.com/services/T0A2H7V3L/B05M8X9K2/wR7j8Q4p2k9L3m5N6o8P9q \
  -H 'Content-Type: application/json' \
  -d '{
    "blocks": [
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "🧪 *Teste de webhook* — Se você vê esta mensagem, tudo está funcionando!"
        }
      }
    ]
  }'
```

---

## Formato esperado das mensagens

Quando o Supervisor envia alertas, eles aparecem assim no Slack:

```
┌─────────────────────────────────────────┐
│ 🔍 Relatório Supervisor — Pepito        │
├─────────────────────────────────────────┤
│ Horário: 2026-07-01T10:35:53Z           │
│ Verificações: 6 | Falhadas: 0           │
├─────────────────────────────────────────┤
│ 🔴 MUITO ALTO (0)                        │
│ 🟠 ALTO (1)                              │
│    • API PLD Queue: Fila vazia           │
│      Nenhum caso para análise.           │
│ 🟡 MÉDIO (0)                             │
│ 🔵 BAIXO (1)                             │
│    • Git Repository: Mudanças N/Commit  │
│      2 arquivo(s) modificado(s).        │
└─────────────────────────────────────────┘
```

---

## Configurações avançadas (opcional)

### Personalizar nome do app no Slack

Se quiser que apareça com outro nome/emoji nas mensagens:

1. Vá para: https://api.slack.com/apps
2. Selecione seu app "Pepito Supervisor"
3. **Settings** → **Basic Information** → **Display Information**
4. Customize:
   - **App name:** `Pepito Supervisor` (ou outro nome)
   - **Description:** `Monitoramento diário da aplicação Pepito`
   - **App icon:** Procure por uma imagem (opcional)
5. Clique em **Save**

### Customizar canal por tipo de alerta

Se quiser alertas MUITO ALTO num canal crítico e BAIXO noutro:

1. Crie 2 webhooks (um para cada canal)
2. No `.env`, configure dois webhooks diferentes
3. Edite `supervisor-agent.py` para escolher por nível:

```python
# Na função enviar_para_slack():
if any(a["nivel"] == "🔴 MUITO ALTO" for a in resultado["alertas"]):
    webhook_critico = os.getenv("SLACK_WEBHOOK_CRITICO")
    requests.post(webhook_critico, json=payload)
else:
    webhook_normal = os.getenv("SLACK_WEBHOOK_URL")
    requests.post(webhook_normal, json=payload)
```

---

## Troubleshooting

### ❌ Erro: "Webhook URL inválida"

```
SSLError: Max retries exceeded... Max retries exceeded...
```

**Solução:**
1. Copie a URL novamente (algumas vezes ela vem truncada)
2. Confirme que começa com: `https://hooks.slack.com/services/`
3. Não coloque aspas extras: `SLACK_WEBHOOK_URL=URL` (não `SLACK_WEBHOOK_URL="URL"`)

### ❌ Erro: "Forbidden" ou "404"

```
{
  "ok": false,
  "error": "invalid_webhook"
}
```

**Solução:**
1. Webhook pode estar expirado (delete e crie um novo)
2. Verifique que URL está completa (não faltam caracteres)
3. Confirme que o app ainda tem permissão no workspace

### ❌ Mensagens não aparecem no Slack

**Checklist:**
- [ ] URL configurada em `.env`? → `echo $SLACK_WEBHOOK_URL`
- [ ] Servidor reiniciado após editar `.env`? → `pkill -f "node server"`
- [ ] Canal existe e webhook aponta para ele?
- [ ] Há alertas para enviar? → `cat .tools/supervisor-last-report.json | grep alertas`
- [ ] Log mostra "Alertas enviados"? → `tail -20 .tools/supervisor.log`

### ❌ Webhook "removida do workspace"

Se você deletou o app ou removeu do workspace:
1. Vá para https://api.slack.com/apps
2. Recrie o webhook (Passo 3)
3. Copie a nova URL
4. Atualize `.env`

---

## Próximas configurações

### 1. Agendar supervisor diário

```bash
# Adicionar ao crontab:
0 6 * * * /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor-schedule.sh
```

Assim receberá alertas **automaticamente todo dia às 6h**.

### 2. Filtrar alertas por nível

Se quer ignorar alertas BAIXO, editar `.tools/supervisor-agent.py`:

```python
# Linha ~450, função enviar_para_slack():
# Antes de "blocks.append", adicione:
if "🔵 BAIXO" in nivel:
    continue  # Pula alertas baixos
```

### 3. Adicionar reações e threads

Se um analista clicar em reação no Slack:
```python
# Em supervisor-agent.py, adicionar:
payload["thread_ts"] = "timestamp_de_msg_anterior"
```

---

## Referências

- **Slack API Docs:** https://api.slack.com/messaging/webhooks
- **Block Kit (formato):** https://api.slack.com/block-kit
- **Seu workspace:** https://api.slack.com/apps (gerenciar apps)
- **Documentação Supervisor:** `.tools/SUPERVISOR.md`

---

## Sumário rápido (copiar-colar)

```bash
# 1. Copie a URL do webhook do Slack
URL="https://hooks.slack.com/services/T.../B.../..."

# 2. Adicione ao .env
echo "SLACK_WEBHOOK_URL=$URL" >> /Users/thay/Projetos\ Thay/.env

# 3. Teste
cd /Users/thay/Projetos\ Thay/pepito-frontend
python3 .tools/supervisor-agent.py

# 4. Agende (opcional)
# crontab -e
# 0 6 * * * /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor-schedule.sh
```

---

**Perguntas?** Verifique `.tools/SUPERVISOR.md` ou `README.md` seção "Supervisor Agent"
