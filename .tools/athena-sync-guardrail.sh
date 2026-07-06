#!/bin/bash
# athena-sync-guardrail.sh — Garante que após sync de Athena, todos os casos têm sugestões
# Execute APÓS cada atualização de Athena

set -euo pipefail

ROOT="/Users/thay/Projetos Thay"
PEPITO="${ROOT}/pepito-frontend"
LOG="${PEPITO}/.tools/athena-sync-guardrail.log"

{
  echo ""
  echo "=== $(date -Iseconds) ATHENA SYNC GUARDRAIL START ==="

  cd "${PEPITO}"

  # 1. Regenera sugestões que faltam
  echo "[1/3] Verificando e regenerando sugestões faltando..."
  python3 .tools/regenerate-missing-suggestions.py

  # 2. Rebuild
  echo ""
  echo "[2/3] Fazendo rebuild da aplicação..."
  npm run build 2>&1 | tail -5

  # 3. Restart servidor se estiver rodando
  echo ""
  echo "[3/3] Reiniciando servidor..."
  if pgrep -f "node server.cjs" > /dev/null; then
    pkill -f "node server.cjs" || true
    sleep 2
    NODE_ENV=production PORT=4173 /opt/homebrew/opt/node@20/bin/node server.cjs &
    echo "✓ Servidor reiniciado"
  else
    echo "⚠️  Servidor não estava rodando — skipping restart"
  fi

  echo ""
  echo "=== $(date -Iseconds) ATHENA SYNC GUARDRAIL DONE ==="
  echo "✅ Todas as análises agora têm sugestões parecer"

} >> "$LOG" 2>&1

exit 0
