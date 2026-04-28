#!/bin/bash
echo "=== Quick Fix for CORS Duplicate Headers ==="
echo
echo "This fixes: 'Access-Control-Allow-Origin header contains multiple values'"
echo

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "1. Creating simple nginx config without map directive..."
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
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.dosco.live;

    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/api.dosco.live/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.dosco.live/privkey.pem;
    
    # SSL optimizations
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

        # Handle preflight OPTIONS requests
        if ($request_method = 'OPTIONS') {
            add_header Content-Length 0 always;
            add_header Content-Type text/plain always;
            return 204;
        }
    }
}
EOF

echo "2. Enabling nginx site..."
sudo ln -sf /etc/nginx/sites-available/api.dosco.live.conf \
           /etc/nginx/sites-enabled/

echo "3. Testing nginx configuration..."
if sudo nginx -t; then
    echo -e "   ${GREEN}✓ nginx configuration is valid${NC}"
else
    echo -e "   ${RED}✗ nginx configuration test failed${NC}"
    exit 1
fi

echo "4. Reloading nginx..."
sudo systemctl reload nginx
if [ $? -eq 0 ]; then
    echo -e "   ${GREEN}✓ nginx reloaded successfully${NC}"
else
    echo -e "   ${RED}✗ nginx reload failed${NC}"
    exit 1
fi

echo "5. Important: CORS is now handled ONLY by Node.js server"
echo "   Make sure Node.js server has proper CORS configuration"
echo
echo "6. Testing connection..."
echo "   Local server:"
if timeout 2 curl -s http://localhost:8000/health >/dev/null; then
    echo -e "   ${GREEN}✓ Local server responding${NC}"
else
    echo -e "   ${RED}✗ Local server NOT responding${NC}"
fi

echo "   External HTTPS:"
if timeout 3 curl -s -I https://api.dosco.live/health 2>/dev/null | head -1 | grep -q "200\|301"; then
    echo -e "   ${GREEN}✓ External connection working${NC}"
else
    echo -e "   ${YELLOW}⚠ External connection may need CORS from Node.js${NC}"
fi

echo
echo "=== Summary ==="
echo "1. Removed CORS headers from nginx"
echo "2. Nginx now only proxies to localhost:8000"
echo "3. CORS must be handled by Node.js server"
echo
echo "If you still get CORS errors, ensure Node.js server has:"
echo "  app.use(cors({ origin: 'https://app.dosco.live' }))"
echo
echo "To add CORS back to nginx later, use the proper config without 'map' directive."