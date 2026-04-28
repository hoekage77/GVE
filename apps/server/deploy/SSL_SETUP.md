# SSL Setup for api.dosco.live

## Option 1: Let's Encrypt (Recommended for Production)

### 1. Install Certbot
```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
```

### 2. Obtain Certificate
```bash
sudo certbot --nginx -d api.dosco.live
```

### 3. Auto-renewal (already set up by Certbot)
```bash
sudo certbot renew --dry-run
```

## Option 2: Self-Signed Certificate (Development)

### 1. Generate Self-Signed Certificate
```bash
mkdir -p /etc/nginx/ssl/api.dosco.live
cd /etc/nginx/ssl/api.dosco.live

# Generate private key
openssl genrsa -out privkey.pem 2048

# Generate CSR
openssl req -new -key privkey.pem -out csr.pem \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=api.dosco.live"

# Generate self-signed certificate
openssl x509 -req -days 365 -in csr.pem -signkey privkey.pem -out fullchain.pem

# Clean up CSR
rm csr.pem
```

### 2. Update nginx config paths
Change these lines in `nginx-api.dosco.live.conf`:
```nginx
ssl_certificate /etc/nginx/ssl/api.dosco.live/fullchain.pem;
ssl_certificate_key /etc/nginx/ssl/api.dosco.live/privkey.pem;
```

## Option 3: Existing Certificates

If you already have certificates from another provider, update these paths:
```nginx
ssl_certificate /path/to/your/certificate.pem;
ssl_certificate_key /path/to/your/private.key;
```

## Apply Configuration

### 1. Copy nginx config
```bash
sudo cp /root/GVE/apps/server/deploy/nginx-api.dosco.live.conf \
        /etc/nginx/sites-available/api.dosco.live.conf
```

### 2. Enable site
```bash
sudo ln -sf /etc/nginx/sites-available/api.dosco.live.conf \
            /etc/nginx/sites-enabled/
```

### 3. Test configuration
```bash
sudo nginx -t
```

### 4. Reload nginx
```bash
sudo systemctl reload nginx
```

### 5. Check SSL
```bash
curl -I https://api.dosco.live/health
```

## Troubleshooting

### 1. Check nginx status
```bash
sudo systemctl status nginx
sudo journalctl -u nginx --since "5 minutes ago"
```

### 2. Check SSL certificate
```bash
openssl s_client -connect api.dosco.live:443 -servername api.dosco.live
```

### 3. Check firewall
```bash
sudo ufw status
sudo ufw allow 443/tcp
```

### 4. DNS verification
```bash
dig api.dosco.live +short
ping -c 3 api.dosco.live
```

## Development Alternative

For local development, you can bypass SSL entirely:
1. Set web app to use `VITE_API_BASE_URL=http://localhost:8000`
2. Access web app at `http://localhost:5173`
3. No SSL certificates needed