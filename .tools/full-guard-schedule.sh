#!/bin/bash
# full-guard-schedule.sh — Executa Supervisor + Integrity Guard
# Executa diariamente para monitorar saúde E integridade dos dados

set -euo pipefail

ROOT="/Users/thay/Projetos Thay"
LOG="${ROOT}/pepito-frontend/.tools/full-guard.log"

{
  echo ""
  echo "=== $(date -Iseconds) FULL GUARD START ==="

  cd "${ROOT}/pepito-frontend"

  # Carrega variáveis de ambiente
  if [ -f "${ROOT}/.env" ]; then
    set -a
    source "${ROOT}/.env"
    set +a
  fi

  # Ativa venv se existir
  if [ -f "${ROOT}/.venv/bin/activate" ]; then
    source "${ROOT}/.venv/bin/activate"
  fi

  # ========================================
  # 1. Integrity Guard (proteção de dados)
  # ========================================
  echo "[1/2] Executando Integrity Guard..."
  python3 .tools/integrity-guard.py || echo "[AVISO] Integrity Guard retornou erro"

  # ========================================
  # 2. Supervisor Agent (monitoramento)
  # ========================================
  echo ""
  echo "[2/2] Executando Supervisor Agent..."
  python3 .tools/supervisor-agent.py || echo "[AVISO] Supervisor Agent retornou erro"

  echo ""
  echo "=== $(date -Iseconds) FULL GUARD DONE ==="

} >> "$LOG" 2>&1

exit 0
