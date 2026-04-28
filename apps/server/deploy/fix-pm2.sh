#!/bin/bash
echo "=== Fixing PM2 Configuration ==="
echo

# Check current PM2 status
echo "1. Current PM2 Status:"
pm2 status dosco-api
echo

# Delete the current process
echo "2. Stopping and deleting current process..."
pm2 delete dosco-api
echo

# Check which ecosystem config to use
echo "3. Checking ecosystem configurations..."
if [ -f "/root/GVE/apps/server/ecosystem.config.cjs" ]; then
    echo "   Using: /root/GVE/apps/server/ecosystem.config.cjs"
    CONFIG="/root/GVE/apps/server/ecosystem.config.cjs"
elif [ -f "/root/GVE/apps/server/deploy/ecosystem.config.cjs" ]; then
    echo "   Using: /root/GVE/apps/server/deploy/ecosystem.config.cjs"
    CONFIG="/root/GVE/apps/server/deploy/ecosystem.config.cjs"
    echo "   WARNING: This config may try to run TypeScript directly!"
    echo "   Consider using the one in /root/GVE/apps/server/ instead"
else
    echo "   ERROR: No ecosystem config found!"
    exit 1
fi

# Start with correct config
echo "4. Starting PM2 with correct config..."
pm2 start "$CONFIG"
echo

# Wait a moment
sleep 2

# Check status
echo "5. New PM2 Status:"
pm2 status dosco-api
echo

# Check if server is actually listening
echo "6. Checking if server is listening on port 8000..."
if ss -tlnp | grep -q :8000; then
    echo "   ✓ Server is listening on port 8000"
    PID=$(ss -tlnp | grep :8000 | awk '{print $NF}' | cut -d= -f2 | cut -d, -f1)
    echo "   Process PID: $PID"
else
    echo "   ✗ Server NOT listening on port 8000"
    echo "   Checking PM2 logs..."
    pm2 logs dosco-api --lines 10
fi
echo

# Test local connection
echo "7. Testing local connection..."
timeout 2 curl -s http://localhost:8000/health >/dev/null
if [ $? -eq 0 ]; then
    echo "   ✓ Local server responds on port 8000"
else
    echo "   ✗ Local server NOT responding on port 8000"
fi
echo

echo "=== Next Steps ==="
echo "1. Check nginx configuration:"
echo "   sudo nginx -t"
echo "   sudo systemctl reload nginx"
echo
echo "2. Test external connection:"
echo "   curl -I https://api.dosco.live/health"
echo
echo "3. Check nginx logs if still having issues:"
echo "   sudo tail -f /var/log/nginx/error.log"
echo "   sudo tail -f /var/log/nginx/access.log"