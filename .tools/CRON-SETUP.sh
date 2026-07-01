#!/bin/bash
# Script para adicionar Supervisor Agent ao crontab
# Execute: bash .tools/CRON-SETUP.sh

echo "Adicionando Supervisor Agent ao crontab..."
echo ""

# Criar backup do crontab atual
crontab -l > /tmp/crontab.backup 2>/dev/null
echo "✓ Backup criado: /tmp/crontab.backup"

# Adicionar linhas do supervisor
(
  crontab -l 2>/dev/null || echo "CRON_TZ=America/Sao_Paulo"
  echo ""
  echo "# Supervisor Agent — Monitoramento diário da aplicação Pepito"
  echo "# Executa às 6h e 14h (horário de São Paulo)"
  echo "0 6 * * * NODE_ENV=development /Users/thay/Projetos\\ Thay/pepito-frontend/.tools/supervisor-schedule.sh >> /Users/thay/Projetos\\ Thay/pepito-frontend/.tools/supervisor.log 2>&1"
  echo "0 14 * * * NODE_ENV=development /Users/thay/Projetos\\ Thay/pepito-frontend/.tools/supervisor-schedule.sh >> /Users/thay/Projetos\\ Thay/pepito-frontend/.tools/supervisor.log 2>&1"
) | crontab -

if [ $? -eq 0 ]; then
  echo "✓ Supervisor Agent adicionado ao crontab com sucesso!"
  echo ""
  echo "Próximas execuções agendadas:"
  crontab -l | grep "Supervisor" -A 2
  echo ""
  echo "Para acompanhar os logs em tempo real:"
  echo "  tail -f /Users/thay/Projetos\ Thay/pepito-frontend/.tools/supervisor.log"
else
  echo "❌ Erro ao adicionar ao crontab"
  echo "Tente manualmente: crontab -e"
  exit 1
fi
