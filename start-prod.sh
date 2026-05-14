#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# start-prod.sh — Inicia o Pepito em modo produção com SSO Google @cora.com.br
#
# Requer APP_URL com HTTPS configurado no .env e túnel/EC2 apontando para a porta.
# ─────────────────────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")"

NODE_BIN=".tools/node/bin"
export PATH="$NODE_BIN:$PATH"

echo "🔨 Compilando..."
npm run build

echo ""
echo "▶  Iniciando servidor em modo PRODUÇÃO (SSO Google)..."
node server.cjs
