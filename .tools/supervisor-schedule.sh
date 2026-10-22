#!/usr/bin/env bash
# supervisor-schedule.sh — Agendador do Supervisor Agent
# Executa verificações diárias e envia alertas para Slack

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="${ROOT}/pepito-frontend/.tools/supervisor.log"

{
  echo ""
  echo "=== $(date -Iseconds) supervisor-agent start ==="

  cd "${ROOT}/pepito-frontend"

  # Carrega variáveis de ambiente (incluindo SLACK_WEBHOOK_URL) — parser
  # defensivo, NÃO usa `source`/`eval` (mesmo padrão de full-guard-schedule.sh):
  # o .env raiz recebe blocos de credenciais AWS SSO com cabeçalhos estilo INI
  # ("[perfil]"), que não são bash válido e abortariam o script inteiro sob
  # `set -e`; além disso, um valor malformado/malicioso não deve poder
  # executar comandos arbitrários. Só processa linhas KEY=VALUE.
  if [ -f "${ROOT}/.env" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%$'\r'}"
      [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
      export "${BASH_REMATCH[2]}=${BASH_REMATCH[3]}"
    done < "${ROOT}/.env"
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
