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

  # Carrega variáveis de ambiente — parser defensivo, NÃO usa `source`.
  # O .env raiz recebe blocos de credenciais AWS SSO injetados por outra
  # ferramenta, incluindo cabeçalhos estilo INI ("[perfil]") que não são
  # bash válido. Sob `set -e`, `source` nessas linhas abortava o script
  # inteiro antes de rodar Integrity Guard/Supervisor (silencioso desde
  # 16/07 — só aparecia como "command not found" no log). Só processa
  # linhas KEY=VALUE (com ou sem "export"); ignora o resto.
  if [ -f "${ROOT}/.env" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
      export "${BASH_REMATCH[2]}=${BASH_REMATCH[3]}"
    done < "${ROOT}/.env"
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
