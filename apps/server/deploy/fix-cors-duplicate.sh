#!/bin/bash
echo "=== Fixing CORS Duplicate Headers Issue ==="
echo
echo "This script fixes: 'Access-Control-Allow-Origin header contains multiple values'"
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "1. Checking current setup..."

# Check if we're in the right directory
if [ ! -f "/root/GVE/apps/server/package.json" ]; then
    echo -e "${RED}ERROR: Not in /root/GVE/apps/server directory${NC}"
    echo "Please run: cd /root/GVE/apps/server"
    exit 1
fi

cd /root/GVE/apps/server

echo "2. Updating Node.js server to remove CORS middleware..."
echo "   (CORS will be handled by nginx only)"

# Check if create-app.ts needs updating
if grep -q "import cors" server/create-app.ts 2>/dev/null; then
    echo "   Updating create-app.ts..."
    cat > server/create-app.ts << 'EOF'
import express from "express";

import { apiRouter } from "./routes/api.js";
import { initializeSessions } from "./state/session.js";
import { initializeTokenUsage } from "./state/token-usage.js";

export function createApp(): express.Express {
  initializeSessions();
  initializeTokenUsage();
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.use("/", apiRouter);
  return app;
}
EOF
    echo "   ✓ Updated create-app.ts"
else
    echo "   ✓ create-app.ts already updated"
fi

echo "3. Rebuilding server..."
npm run build
if [ $? -eq 0 ]; then
    echo -e "   ${GREEN}✓ Server built successfully${NC}"
else
    echo -e "   ${RED}✗ Build failed${NC}"
    exit 1
fi

echo "4. Updating nginx configuration..."
if [ -f "deploy/nginx-api.dosco.live-fixed.conf" ]; then
    echo "   Using fixed nginx config from deploy directory..."
    sudo cp deploy/nginx-api.dosco.live-fixed.conf \
           /etc/nginx/sites-available/api.dosco.live.conf
else
    echo "   Creating fixed nginx config..."
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

    # SSL configuration - update these paths with your actual certificate locations
    ssl_certificate /etc/letsencrypt/live/api.dosco.live/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.dosco.live/privkey.pem;
    
    # SSL optimizations
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    client_max_body_size 20m;

    # Map allowed origins for CORS
    map $http_origin $cors_origin {
        default "";
        "https://app.dosco.live" "https://app.dosco.live";
        "http://localhost:3000" "http://localhost:3000";
        "http://localhost:5173" "http://localhost:5173";
        "http://127.0.0.1:3000" "http://127.0.0.1:3000";
        "http://127.0.0.1:5173" "http://127.0.0.1:5173";
    }

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
            # Only add CORS headers if origin is allowed
            if ($cors_origin != "") {
                add_header Access-Control-Allow-Origin $cors_origin always;
                add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
                add_header Access-Control-Allow-Headers "Content-Type, Authorization, x-user-id, x-request-id" always;
                add_header Access-Control-Allow-Credentials "true" always;
            }
            add_header Content-Length 0 always;
            add_header Content-Type text/plain always;
            return 204;
        }

        # CORS headers for actual requests (only if origin is allowed)
        if ($cors_origin != "") {
            add_header Access-Control-Allow-Origin $cors_origin always;
            add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Content-Type, Authorization, x-user-id, x-request-id" always;
            add_header Access-Control-Allow-Credentials "true" always;
        }
    }
}
EOF
fi

echo "5. Testing nginx configuration..."
sudo nginx -t
if [ $? -eq 0 ]; then
    echo -e "   ${GREEN}✓ nginx configuration is valid${NC}"
else
    echo -e "   ${RED}✗ nginx configuration test failed${NC}"
    exit 1
fi

echo "6. Enabling nginx site..."
sudo ln -sf /etc/nginx/sites-available/api.dosco.live.conf \
           /etc/nginx/sites-enabled/

echo "7. Reloading nginx..."
sudo systemctl reload nginx
if [ $? -eq 0 ]; then
    echo -e "   ${GREEN}✓ nginx reloaded successfully${NC}"
else
    echo -e "   ${RED}✗ nginx reload failed${NC}"
    exit 1
fi

echo "8. Restarting PM2 process..."
pm2 delete dosco-api 2>/dev/null

# Check which ecosystem config to use
if [ -f "ecosystem.config.cjs" ] && grep -q "dist/index.js" ecosystem.config.cjs; then
    echo "   Using ecosystem.config.cjs (uses dist/index.js)"
    pm2 start ecosystem.config.cjs
elif [ -f "deploy/ecosystem.config.cjs" ]; then
    echo "   Using deploy/ecosystem.config.cjs"
    pm2 start deploy/ecosystem.config.cjs
else
    echo -e "   ${YELLOW}Warning: No ecosystem config found, starting manually${NC}"
    pm2 start --name dosco-api node -- dist/index.js
fi

echo "9. Waiting for server to start..."
sleep 3

echo "10. Checking server status..."
pm2 status dosco-api

echo "11. Testing connections..."
echo "    Local connection:"
timeout 2 curl -s http://localhost:8000/health >/dev/null
if [ $? -eq 0 ]; then
    echo -e "    ${GREEN}✓ Local server responds on port 8000${NC}"
else
    echo -e "    ${RED}✗ Local server NOT responding on port 8000${NC}"
    echo "    Checking PM2 logs..."
    pm2 logs dosco-api --lines 10
fi

echo
echo "    External HTTPS connection:"
timeout 3 curl -s -I https://api.dosco.live/health 2>/dev/null | head -1
if [ $? -eq 0 ]; then
    echo -e "    ${GREEN}✓ External HTTPS connection works${NC}"
else
    echo -e "    ${RED}✗ External HTTPS connection failed${NC}"
fi

echo
echo "=== Summary ==="
echo "1. Removed CORS middleware from Node.js server"
echo "2. Updated nginx to handle CORS properly (no duplicate headers)"
echo "3. Server should now respond with single Access-Control-Allow-Origin header"
echo
echo "Check browser console for CORS errors. They should be resolved."
echo
echo "If issues persist, check:"
echo "  sudo tail -f /var/log/nginx/error.log"
echo "  pm2 logs dosco-api"