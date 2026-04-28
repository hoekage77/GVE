# IMMEDIATE FIX: nginx "if directive not allowed" error

## Problem
nginx test fails with:
- `"if" directive is not allowed here`
- `protocol options redefined for [::]:443`

## Solution
Replace the broken nginx config with a simple working one:

### 1. Remove duplicate configs
```bash
sudo rm -f /etc/nginx/sites-enabled/api.dosco.live.conf
sudo rm -f /etc/nginx/sites-enabled/default
```

### 2. Create simple config
```bash
sudo tee /etc/nginx/sites-available/api.dosco.live.conf > /dev/null << 'EOF'
# HTTP redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name api.dosco.live;
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name api.dosco.live;

    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/api.dosco.live/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.dosco.live/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

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

        # For OPTIONS requests, handle preflight
        if ($request_method = 'OPTIONS') {
            add_header Access-Control-Allow-Origin "https://app.dosco.live";
            add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
            add_header Access-Control-Allow-Headers "Content-Type, Authorization, x-user-id, x-request-id";
            add_header Access-Control-Allow-Credentials "true";
            add_header Content-Length 0;
            add_header Content-Type text/plain;
            return 204;
        }

        # For actual requests, add CORS headers
        add_header Access-Control-Allow-Origin "https://app.dosco.live" always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, x-user-id, x-request-id" always;
        add_header Access-Control-Allow-Credentials "true" always;
    }
}
EOF
```

### 3. Enable site
```bash
sudo ln -sf /etc/nginx/sites-available/api.dosco.live.conf \
           /etc/nginx/sites-enabled/
```

### 4. Test and reload
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Verify
```bash
curl -I https://api.dosco.live/health
curl -H "Origin: https://app.dosco.live" -X OPTIONS -I https://api.dosco.live/health
```

## Alternative: Use fix script
```bash
cd /root/GVE/apps/server/deploy
chmod +x apply-nginx-fix.sh
./apply-nginx-fix.sh
```

## What This Fix Does
1. **Removes complex `map` directives** that cause syntax errors
2. **Simplifies CORS** - Only allows `https://app.dosco.live`
3. **Fixes duplicate SSL config** warning
4. **Handles preflight OPTIONS requests** properly

## For Development
If you need localhost access:
1. Use `VITE_API_BASE_URL=http://localhost:8000` in web app
2. OR add localhost to the nginx config (add more `if` blocks)

## Check Current Status
```bash
pm2 status dosco-api
ss -tlnp | grep :8000
curl http://localhost:8000/health
```