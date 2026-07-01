#!/usr/bin/env bash
# supervisor-schedule.sh — Agendador do Supervisor Agent
# Executa verificações diárias e envia alertas para Slack

set -euo pipefail

ROOT="/Users/thay/Projetos Thay"
LOG="${ROOT}/pepito-frontend/.tools/supervisor.log"

{
  echo ""
  echo "=== $(date -Iseconds) supervisor-agent start ==="

  cd "${ROOT}/pepito-frontend"

  # Carrega variáveis de ambiente (incluindo SLACK_WEBHOOK_URL)
  if [ -f "${ROOT}/.env" ]; then
    set -a
    source "${ROOT}/.env"
    set +a
  fi

  # Ativa venv se existir
  if [ -f "${ROOT}/.venv/bin/activate" ]; then
    source "${ROOT}/.venv/bin/activate"
  fi

  # Executa o supervisor agent
  python3 .tools/supervisor-agent.py
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    echo "=== $(date -Iseconds) supervisor-agent completed (OK) ==="
  else
    echo "=== $(date -Iseconds) supervisor-agent completed (FAILED - exit $EXIT_CODE) ==="
  fi

} >> "$LOG" 2>&1

exit 0
