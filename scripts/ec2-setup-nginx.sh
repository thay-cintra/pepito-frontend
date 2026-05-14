#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# ec2-setup-nginx.sh — Configura Nginx + Let's Encrypt no EC2 para HTTPS
#
# Execute DENTRO da instância EC2 após o deploy-aws-ec2.sh.
# Uso: DOMAIN=pepito.suaempresa.com bash ec2-setup-nginx.sh
# ─────────────────────────────────────────────────────────────────────────────

DOMAIN="${DOMAIN:?Defina DOMAIN=pepito.suaempresa.com}"

# Amazon Linux 2
if command -v yum &>/dev/null; then
  sudo amazon-linux-extras enable nginx1
  sudo yum install -y nginx certbot python3-certbot-nginx
else
  # Ubuntu
  sudo apt-get update -q
  sudo apt-get install -y nginx certbot python3-certbot-nginx
fi

sudo tee /etc/nginx/conf.d/pepito.conf > /dev/null <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

sudo nginx -t && sudo systemctl restart nginx
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m infra@cora.com.br

echo ""
echo "✅ HTTPS configurado em https://${DOMAIN}"
echo "   Atualize APP_URL=https://${DOMAIN} no .env e re-execute deploy-aws-ec2.sh"
