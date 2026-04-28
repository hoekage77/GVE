# Fix CORS Duplicate Headers Issue

## Problem
Browser shows: "The 'Access-Control-Allow-Origin' header contains multiple values 'https://app.dosco.live, https://app.dosco.live'"

## Root Cause
Both nginx AND Node.js server are adding CORS headers, causing duplicates.

## Solution
1. Remove CORS middleware from Node.js server (let nginx handle CORS)
2. Fix nginx config to only add CORS headers when origin is allowed

## Commands to Run

```bash
cd /root/GVE/apps/server

# 1. Update Node.js server to remove CORS middleware
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

# 2. Rebuild server
npm run build

# 3. Update nginx config
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

# 4. Enable nginx site
sudo ln -sf /etc/nginx/sites-available/api.dosco.live.conf \
           /etc/nginx/sites-enabled/

# 5. Test nginx config
sudo nginx -t

# 6. Reload nginx
sudo systemctl reload nginx

# 7. Restart PM2 process
pm2 delete dosco-api

# Make sure ecosystem.config.cjs uses dist/index.js (not server/index.js)
if [ -f "ecosystem.config.cjs" ]; then
    pm2 start ecosystem.config.cjs
else
    pm2 start --name dosco-api node -- dist/index.js
fi

# 8. Wait and check
sleep 3
pm2 status dosco-api

# 9. Test
curl -I https://api.dosco.live/health
```

## Alternative: Use Fix Script

```bash
cd /root/GVE/apps/server/deploy
chmod +x fix-cors-duplicate.sh
./fix-cors-duplicate.sh
```

## Verification

After fixing:
1. Browser console should no longer show "multiple values" CORS error
2. `curl -I https://api.dosco.live/health` should return 200 OK
3. Check response headers: should have single `Access-Control-Allow-Origin: https://app.dosco.live`

## Debugging

If issues persist:
```bash
# Check nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# Check PM2 logs
pm2 logs dosco-api

# Test without nginx (direct to server)
curl http://localhost:8000/health

# Test CORS headers
curl -H "Origin: https://app.dosco.live" \
     -H "Access-Control-Request-Method: GET" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS -I https://api.dosco.live/health
```