#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# start-local.sh — Inicia o Pepito em modo VPN/rede interna (sem SSO Google)
#
# As analistas acessam pelo IP exibido no terminal.
# Segurança garantida pela VPN Cora — nenhum acesso externo.
# ─────────────────────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")"

NODE_BIN=".tools/node/bin"
export PATH="$NODE_BIN:$PATH"

echo "🔨 Compilando..."
npm run build

echo ""
echo "▶  Iniciando servidor em modo LOCAL/VPN..."
LOCAL_MODE=true node server.cjs
