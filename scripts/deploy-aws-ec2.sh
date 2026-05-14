#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-aws-ec2.sh — Empacota e envia o Pepito para uma instância EC2
#
# Pré-requisitos:
#   1. AWS CLI configurado (aws configure)
#   2. Instância EC2 rodando Amazon Linux 2 ou Ubuntu 22.04
#   3. Chave SSH (.pem) com acesso à instância
#   4. Porta 443 (HTTPS) e 80 (HTTP) abertas no Security Group
#
# Uso:
#   chmod +x scripts/deploy-aws-ec2.sh
#   EC2_HOST=ec2-xx-xx-xx-xx.compute-1.amazonaws.com \
#   EC2_KEY=~/.ssh/minha-chave.pem \
#   ./scripts/deploy-aws-ec2.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")/.."

EC2_HOST="${EC2_HOST:?Defina EC2_HOST=ec2-xx.compute.amazonaws.com}"
EC2_KEY="${EC2_KEY:?Defina EC2_KEY=~/.ssh/chave.pem}"
EC2_USER="${EC2_USER:-ec2-user}"   # ubuntu para Ubuntu AMI
REMOTE_DIR="/home/${EC2_USER}/pepito"

NODE_BIN=".tools/node/bin"
export PATH="$NODE_BIN:$PATH"

echo "🔨 Build local..."
npm run build

echo "📦 Empacotando..."
tar czf /tmp/pepito-deploy.tar.gz \
  dist/ \
  src/data/ \
  server.cjs \
  package.json \
  package-lock.json \
  .env

echo "📤 Enviando para EC2 ${EC2_HOST}..."
scp -i "$EC2_KEY" -o StrictHostKeyChecking=no \
  /tmp/pepito-deploy.tar.gz \
  "${EC2_USER}@${EC2_HOST}:/tmp/pepito-deploy.tar.gz"

echo "🚀 Instalando e reiniciando no servidor..."
ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "${EC2_USER}@${EC2_HOST}" bash <<'REMOTE'
  set -e

  # Instala Node 20 se não tiver
  if ! command -v node &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs 2>/dev/null || sudo apt-get install -y nodejs
  fi

  # Instala PM2 se não tiver
  if ! command -v pm2 &>/dev/null; then
    sudo npm install -g pm2
  fi

  mkdir -p ~/pepito
  cd ~/pepito
  tar xzf /tmp/pepito-deploy.tar.gz
  npm ci --omit=dev

  pm2 stop pepito 2>/dev/null || true
  pm2 start server.cjs --name pepito
  pm2 save
  pm2 startup 2>/dev/null || true

  echo "✅ Pepito rodando em http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):4173"
REMOTE

echo ""
echo "✅ Deploy concluído!"
echo "   Configure um Load Balancer ou Nginx com HTTPS no EC2 para usar SSO Google."
echo "   Adicione o callback no Google Cloud: https://SEU_DOMINIO/auth/google/callback"
