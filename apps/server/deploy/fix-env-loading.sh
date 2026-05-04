#!/bin/bash
echo "=== Fixing Environment Variable Loading ==="
echo

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd /root/GVE/apps/server || { echo -e "${RED}Failed to cd to /root/GVE/apps/server${NC}"; exit 1; }

echo "1. Checking for .env files..."
if [ -f "server/.env" ]; then
    echo -e "   ${GREEN}✓ Found server/.env${NC}"
else
    echo -e "   ${RED}✗ Missing server/.env${NC}"
    exit 1
fi

echo "2. Copying .env to dist/ for runtime..."
cp server/.env dist/.env
if [ $? -eq 0 ]; then
    echo -e "   ${GREEN}✓ Copied .env to dist/.env${NC}"
else
    echo -e "   ${RED}✗ Failed to copy .env${NC}"
    exit 1
fi

echo "3. Verifying dist/.env contains API keys..."
if grep -q "MOONSHOT_API_KEY=" dist/.env 2>/dev/null; then
    echo -e "   ${GREEN}✓ MOONSHOT_API_KEY found${NC}"
else
    echo -e "   ${YELLOW}⚠ MOONSHOT_API_KEY not found${NC}"
fi

if grep -q "DAYTONA_API_KEY=" dist/.env 2>/dev/null; then
    echo -e "   ${GREEN}✓ DAYTONA_API_KEY found${NC}"
else
    echo -e "   ${YELLOW}⚠ DAYTONA_API_KEY not found${NC}"
fi

echo "4. Updating PM2 ecosystem config..."
if [ -f "ecosystem.config.cjs" ]; then
    # Already updated, but verify
    if grep -q "API keys are loaded from dist/.env" ecosystem.config.cjs; then
        echo -e "   ${GREEN}✓ PM2 config already updated${NC}"
    else
        echo -e "   ${YELLOW}⚠ PM2 config may need updating${NC}"
        echo "   Removing API key definitions from ecosystem config..."
        cat > ecosystem.config.cjs << 'EOF'
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'dosco-api',
      cwd: __dirname,
      script: 'node',
      args: 'dist/index.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: 8000
        // API keys are loaded from dist/.env file
      }
    }
  ]
};
EOF
        echo -e "   ${GREEN}✓ PM2 config updated${NC}"
    fi
else
    echo -e "   ${RED}✗ ecosystem.config.cjs not found${NC}"
    exit 1
fi

echo "5. Restarting PM2 process..."
pm2 delete dosco-api 2>/dev/null
sleep 2
pm2 start ecosystem.config.cjs
if [ $? -eq 0 ]; then
    echo -e "   ${GREEN}✓ PM2 process started${NC}"
else
    echo -e "   ${RED}✗ PM2 start failed${NC}"
    exit 1
fi

echo "6. Waiting for server to start..."
sleep 5

echo "7. Checking PM2 status..."
pm2 status dosco-api

echo "8. Checking server logs for Daytona warnings..."
pm2 logs dosco-api --lines 20 2>&1 | grep -i "daytona\|env\|warning\|error" | head -10

echo "9. Testing server health..."
if timeout 3 curl -s http://localhost:8000/health >/dev/null; then
    echo -e "   ${GREEN}✓ Server responding on port 8000${NC}"
else
    echo -e "   ${RED}✗ Server not responding on port 8000${NC}"
    echo "   Checking PM2 logs..."
    pm2 logs dosco-api --lines 10
fi

echo
echo "=== Summary ==="
echo "1. .env file copied to dist/.env"
echo "2. PM2 config updated to not override API keys"
echo "3. PM2 process restarted"
echo
echo "If you still see Daytona warnings, check:"
echo "  - dist/.env file permissions"
echo "  - Server logs: pm2 logs dosco-api"
echo "  - Verify API keys in dist/.env are correct"
echo
echo "To test API keys are loaded:"
echo "  pm2 logs dosco-api | grep -i 'MOONSHOT\|DAYTONA\|GROQ\|GEMINI\|FIREWORKS'"
echo
echo "For production, consider:"
echo "  - Using environment variables instead of .env file"
echo "  - Setting API keys in PM2 config directly (not recommended for secrets)"
echo "  - Using a secrets management service"