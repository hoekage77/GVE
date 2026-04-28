#!/bin/bash
# Generate self-signed SSL certificate for development

set -e

DOMAIN="api.dosco.live"
SSL_DIR="/etc/nginx/ssl/$DOMAIN"

echo "Generating self-signed SSL certificate for $DOMAIN..."

# Create directory
sudo mkdir -p "$SSL_DIR"
cd "$SSL_DIR"

# Generate private key
echo "Generating private key..."
sudo openssl genrsa -out privkey.pem 2048

# Generate CSR
echo "Generating Certificate Signing Request..."
sudo openssl req -new -key privkey.pem -out csr.pem \
  -subj "/C=US/ST=California/L=San Francisco/O=Dosco/CN=$DOMAIN"

# Generate self-signed certificate
echo "Generating self-signed certificate..."
sudo openssl x509 -req -days 365 -in csr.pem -signkey privkey.pem -out fullchain.pem

# Clean up
sudo rm csr.pem

# Set permissions
sudo chmod 600 privkey.pem
sudo chmod 644 fullchain.pem

echo "Certificate generated:"
echo "  Private key: $SSL_DIR/privkey.pem"
echo "  Certificate: $SSL_DIR/fullchain.pem"
echo ""
echo "Update nginx config with these paths:"
echo "  ssl_certificate $SSL_DIR/fullchain.pem;"
echo "  ssl_certificate_key $SSL_DIR/privkey.pem;"

# Create a test nginx config if needed
if [ ! -f "/etc/nginx/sites-available/$DOMAIN.conf" ]; then
  echo "Creating nginx configuration..."
  sudo tee "/etc/nginx/sites-available/$DOMAIN.conf" << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name api.dosco.live;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.dosco.live;

    ssl_certificate /etc/nginx/ssl/api.dosco.live/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/api.dosco.live/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
EOF
  echo "Nginx configuration created at /etc/nginx/sites-available/$DOMAIN.conf"
fi

echo ""
echo "To enable:"
echo "1. sudo ln -sf /etc/nginx/sites-available/$DOMAIN.conf /etc/nginx/sites-enabled/"
echo "2. sudo nginx -t"
echo "3. sudo systemctl reload nginx"
echo ""
echo "Test with: curl -k https://$DOMAIN/health"