#!/bin/bash
echo "=== Connection Diagnostic for api.dosco.live ==="
echo

# 1. Check DNS
echo "1. DNS Resolution:"
echo "   api.dosco.live resolves to:"
dig api.dosco.live +short 2>/dev/null || nslookup api.dosco.live 2>/dev/null | grep Address
echo

# 2. Check server IP
echo "2. Server Public IP:"
curl -s ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}'
echo

# 3. Check if server is running
echo "3. Local Server Status:"
echo "   Port 8000 listening:"
ss -tlnp 2>/dev/null | grep :8000 || echo "   Not listening on port 8000"
echo

# 4. Check if process is running
echo "4. Process Check:"
if command -v pm2 >/dev/null 2>&1; then
    pm2 status dosco-api 2>/dev/null || echo "   PM2 not found or dosco-api not in PM2"
else
    echo "   PM2 command not found"
fi
echo

# 5. Check firewall
echo "5. Firewall Status:"
if command -v ufw >/dev/null 2>&1; then
    ufw status | head -5
elif command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd --list-all
else
    echo "   No firewall tool found"
fi
echo

# 6. Check nginx
echo "6. Web Server Status:"
if command -v nginx >/dev/null 2>&1; then
    echo "   nginx installed"
    systemctl status nginx 2>/dev/null | head -3 || echo "   nginx not running"
else
    echo "   nginx not installed"
fi
echo

# 7. Test local connection
echo "7. Local Connection Test:"
timeout 2 curl -s http://localhost:8000/health >/dev/null
if [ $? -eq 0 ]; then
    echo "   ✓ Local server responds on port 8000"
else
    echo "   ✗ Local server not responding on port 8000"
fi
echo

# 8. Test external connection
echo "8. External Connection Test:"
DOMAIN_IP=$(dig api.dosco.live +short 2>/dev/null | head -1)
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
if [ "$DOMAIN_IP" = "$SERVER_IP" ]; then
    echo "   ✓ DNS points to this server ($SERVER_IP)"
    echo "   Testing connection to api.dosco.live..."
    timeout 3 curl -s -I https://api.dosco.live/health 2>/dev/null | head -1
    timeout 3 curl -s -I http://api.dosco.live/health 2>/dev/null | head -1
else
    echo "   ⚠ DNS points to $DOMAIN_IP, but server IP is $SERVER_IP"
    echo "   This could be:"
    echo "   - Load balancer/proxy at $DOMAIN_IP"
    echo "   - Wrong DNS configuration"
    echo "   - Different production server"
fi
echo

echo "=== Recommended Actions ==="
echo
DOMAIN_IP=$(dig api.dosco.live +short 2>/dev/null | head -1)
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')

if [ "$DOMAIN_IP" != "$SERVER_IP" ]; then
    echo "1. DNS Mismatch Detected:"
    echo "   Option A: Update DNS to point to $SERVER_IP"
    echo "   Option B: Configure this server to work with proxy at $DOMAIN_IP"
    echo
fi

echo "2. Server Setup:"
if ! ss -tlnp 2>/dev/null | grep -q :8000; then
    echo "   - Ensure PM2 process is running: pm2 restart dosco-api"
    echo "   - Check logs: pm2 logs dosco-api"
fi
echo

echo "3. Web Server (nginx):"
if ! command -v nginx >/dev/null 2>&1; then
    echo "   - Install nginx: sudo apt install nginx"
    echo "   - Configure SSL (see SSL_SETUP.md)"
fi
echo

echo "4. Quick Local Development:"
echo "   - Set VITE_API_BASE_URL=http://localhost:8000 in web app"
echo "   - Run web dev server: cd apps/web && npm run dev"
echo "   - Access at http://localhost:5173"