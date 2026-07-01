# Adicionar Guardrails ao Crontab

## ✅ Verificação: Você tem 2 opções

---

## Opção A: Adicionar manualmente (recomendado)

### 1️⃣ Abra o editor de crontab

```bash
crontab -e
```

### 2️⃣ Cole as linhas no final do arquivo

```bash
# ========================================
# INTEGRITY GUARD + SUPERVISOR (Full Guard)
# ========================================
# Executa diariamente:
#   - Integrity Guard: Protege contra exclusão de pareceres
#   - Supervisor Agent: Monitora saúde da aplicação
#
# Horários: 6h (manhã) e 14h (tarde)
CRON_TZ=America/Sao_Paulo
0 6 * * * NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard-schedule.sh >> /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard.log 2>&1
0 14 * * * NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard-schedule.sh >> /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard.log 2>&1
```

### 3️⃣ Salve e saia

- **macOS/Linux:** `ESC` → `:wq` → `Enter`

---

## Opção B: Copiar-colar direto (bash)

Se preferir linha única:

```bash
crontab -l 2>/dev/null || echo "CRON_TZ=America/Sao_Paulo" > /tmp/cron_temp.txt
cat >> /tmp/cron_temp.txt << 'EOF'

# Full Guard (Integrity + Supervisor)
0 6 * * * NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard-schedule.sh >> /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard.log 2>&1
0 14 * * * NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard-schedule.sh >> /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard.log 2>&1
EOF
crontab /tmp/cron_temp.txt
```

---

## ✅ Verificar se foi adicionado

```bash
crontab -l | grep "Full Guard" -A 2
```

**Esperado:**
```
# Full Guard (Integrity + Supervisor)
0 6 * * * NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard-schedule.sh
0 14 * * * NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard-schedule.sh
```

---

## 🧪 Testar agora (antes de agendar)

```bash
cd /Users/thay/Projetos\ Thay/pepito-frontend
NODE_ENV=development /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard-schedule.sh
```

Verifique o log:
```bash
tail -50 /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard.log
```

---

## 📊 O que vai executar

### Full Guard = 2 Ferramentas

```
┌─────────────────────────────────────────────┐
│     Full Guard Schedule (2x por dia)        │
├─────────────────────────────────────────────┤
│                                             │
│  1. Integrity Guard (3-5 segundos)          │
│     ✓ Faz backup de pareceres               │
│     ✓ Detecta deletions                     │
│     ✓ Auto-restaura se necessário           │
│     ✓ Alerta Slack                          │
│                                             │
│  2. Supervisor Agent (5-10 segundos)        │
│     ✓ Verifica 7 componentes                │
│     ✓ Detecta bugs/erros                    │
│     ✓ Alertas por nível de risco            │
│     ✓ Envia para Slack                      │
│                                             │
└─────────────────────────────────────────────┘
```

### Horários

- **🕐 6h da manhã** — Verificação matinal antes de trabalhar
- **🕮 14h da tarde** — Verificação à tarde

---

## 📬 Alertas esperados

### Scenario 1: Tudo OK
```
✅ Integridade OK — nenhum problema
✅ Todas as verificações passaram
[Nenhum alerta enviado]
```

### Scenario 2: Parecer foi deletado
```
⚠️ Integrity Guard Alert (Slack)
🔴 DELETADOS:
   • pareceres-sugestao.json
[Auto-restaurado do backup]
```

### Scenario 3: Servidor offline
```
🔍 Relatório Supervisor — Pepito (Slack)
🔴 MUITO ALTO (1)
   • Servidor Express: Aplicação offline
     Não conseguimos conectar na porta 4173
```

---

## 📈 Monitorar logs

### Ver logs em tempo real
```bash
tail -f /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard.log
```

### Últimas 30 linhas
```bash
tail -30 /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard.log
```

### Contar execuções
```bash
grep "FULL GUARD START" /Users/thay/Projetos\ Thay/pepito-frontend/.tools/full-guard.log | wc -l
```

---

## 🛡️ Guardrails implementados

### Integrity Guard protege:
✅ Pareceres não são deletados acidentalmente  
✅ Backups automáticos 2x por dia  
✅ Auto-restauração de deletions  
✅ Alertas Slack ao detectar problemas  
✅ Histórico completo de integridade  

### Supervisor monitora:
✅ Servidor Node respondendo  
✅ API /queue retornando dados  
✅ Build dist/ atualizado  
✅ Arquivos de dados íntegros  
✅ Git sem mudanças não commitadas  

---

## 💾 Arquivos de backup

Backups salvos em:
```
.tools/backups/pareceres/
├── pareceres-sugestao.json.20260701_060000.backup
├── pareceres-real.json.20260701_060000.backup
├── pareceres-lideranca.json.20260701_060000.backup
├── analises-salvas.json.20260701_060000.backup
└── manifest.json (índice de integridade)
```

---

## 🎯 Próximos passos

1. **Agora:** Adicione ao crontab com `crontab -e`
2. **Depois:** Teste com `bash full-guard-schedule.sh`
3. **Finalmente:** Monitore logs diariamente

---

## ❓ FAQ

**P: O que acontece se parecer foi deletado?**  
R: Integrity Guard detecta, restaura do backup automaticamente e alerta Slack.

**P: Posso desabilitar auto-restauração?**  
R: Sim, edite `.tools/integrity-guard.py` linha ~250 para desabilitar.

**P: Quanto tempo leva?**  
R: ~10-15 segundos total (5s backup + 10s supervisor).

**P: O que fazer se cron falhar?**  
R: Verifique logs: `tail -50 full-guard.log` e rode manualmente: `bash full-guard-schedule.sh`

---

**Status:** ✅ Pronto para produção  
**Criado:** 2026-07-01  
**Versão:** 1.0
