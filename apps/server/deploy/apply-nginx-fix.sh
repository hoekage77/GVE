#!/bin/bash
echo "=== Applying nginx Fix for CORS ==="
echo

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "1. Creating simple nginx configuration..."
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

echo "2. Removing any duplicate configs..."
sudo rm -f /etc/nginx/sites-enabled/api.dosco.live.conf 2>/dev/null
sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null

echo "3. Enabling the site..."
sudo ln -sf /etc/nginx/sites-available/api.dosco.live.conf \
           /etc/nginx/sites-enabled/

echo "4. Testing nginx configuration..."
if sudo nginx -t; then
    echo -e "   ${GREEN}✓ nginx configuration is valid${NC}"
else
    echo -e "   ${RED}✗ nginx configuration test failed${NC}"
    echo "   Attempting backup simple config..."
    
    # Try even simpler config
    sudo tee /etc/nginx/sites-available/api.dosco.live.conf > /dev/null << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name api.dosco.live;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name api.dosco.live;
    
    ssl_certificate /etc/letsencrypt/live/api.dosco.live/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.dosco.live/privkey.pem;
    
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Let Node.js handle CORS entirely
        # No CORS headers here to avoid duplicates
    }
}
EOF
    
    sudo nginx -t
    if [ $? -eq 0 ]; then
        echo -e "   ${GREEN}✓ Backup config is valid${NC}"
    else
        echo -e "   ${RED}✗ Backup config also failed${NC}"
        echo "   Checking nginx error logs..."
        sudo nginx -t 2>&1
        exit 1
    fi
fi

echo "5. Reloading nginx..."
sudo systemctl reload nginx
if [ $? -eq 0 ]; then
    echo -e "   ${GREEN}✓ nginx reloaded successfully${NC}"
else
    echo -e "   ${RED}✗ nginx reload failed${NC}"
    exit 1
fi

echo "6. Testing connections..."
echo "   Local server (port 8000):"
if timeout 2 curl -s http://localhost:8000/health >/dev/null; then
    echo -e "   ${GREEN}✓ Local server responding${NC}"
else
    echo -e "   ${YELLOW}⚠ Local server not responding${NC}"
    echo "   Check PM2: pm2 status dosco-api"
    echo "   Start server: pm2 start ecosystem.config.cjs"
fi

echo "   HTTPS external:"
RESPONSE=$(timeout 3 curl -s -I https://api.dosco.live/health 2>/dev/null | head -1)
if [ -n "$RESPONSE" ]; then
    echo -e "   ${GREEN}✓ External connection: $RESPONSE${NC}"
else
    echo -e "   ${YELLOW}⚠ External connection failed${NC}"
    echo "   This could be DNS, SSL, or server issues"
fi

echo
echo "=== Summary ==="
echo "1. Applied simple nginx config with CORS for https://app.dosco.live"
echo "2. Removed duplicate configs"
echo "3. CORS headers now come ONLY from nginx (Node.js CORS removed)"
echo
echo "If CORS errors persist in browser:"
echo "1. Check browser console for exact error"
echo "2. Test CORS manually:"
echo "   curl -H 'Origin: https://app.dosco.live' -X OPTIONS -I https://api.dosco.live/health"
echo
echo "For development with localhost:"
echo "1. Update nginx config to add localhost to allowed origins"
echo "2. Or use VITE_API_BASE_URL=http://localhost:8000 for local development"