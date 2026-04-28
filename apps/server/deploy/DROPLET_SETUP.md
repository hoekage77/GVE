# Digital Ocean Droplet Setup for api.dosco.live

## Current Issue
- DNS: `api.dosco.live` → `64.23.182.28` (Load Balancer/Proxy)
- This droplet: `102.91.98.182`
- Connection fails because traffic isn't reaching this droplet properly

## Solution Options

### Option 1: Direct DNS (Simplest)
Update DNS to point directly to this droplet:
```bash
# In your DNS provider (Cloudflare, Digital Ocean DNS, etc.):
# Change A record for api.dosco.live to 102.91.98.182
```

Then set up this droplet:
```bash
# 1. Install nginx
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx

# 2. Copy nginx config
sudo cp /root/GVE/apps/server/deploy/nginx-api.dosco.live.conf \
        /etc/nginx/sites-available/api.dosco.live.conf

# 3. Enable site
sudo ln -sf /etc/nginx/sites-available/api.dosco.live.conf \
           /etc/nginx/sites-enabled/

# 4. Get SSL certificate
sudo certbot --nginx -d api.dosco.live

# 5. Configure firewall
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8000/tcp  # For local connections
sudo ufw enable

# 6. Restart services
sudo systemctl reload nginx
pm2 restart dosco-api
```

### Option 2: Load Balancer Configuration
If `64.23.182.28` is a Digital Ocean Load Balancer:

1. **Load Balancer Backend**: Ensure this droplet (`102.91.98.182`) is added as a backend
2. **Health Checks**: Configure to check port 8000 or 80
3. **Firewall**: Allow traffic from load balancer IPs

```bash
# Allow Digital Ocean Load Balancer IPs
sudo ufw allow from 64.23.182.28 to any port 8000
sudo ufw allow from 64.23.182.28 to any port 80
sudo ufw allow from 64.23.182.28 to any port 443
```

### Option 3: Local Development Bypass
For immediate development, bypass the domain entirely:

1. **Web App Configuration** (`apps/web/.env.local`):
   ```bash
   VITE_API_BASE_URL=http://localhost:8000
   ```

2. **Run web app locally**:
   ```bash
   cd apps/web
   npm run dev  # Runs on http://localhost:5173
   ```

3. **Server already running** via PM2 on port 8000

4. **Test connection**:
   ```bash
   curl http://localhost:8000/health
   ```

## Diagnostic Results

Run the diagnostic script:
```bash
cd apps/server/deploy
chmod +x diagnose-connection.sh
./diagnose-connection.sh
```

## Common Digital Ocean Issues

### 1. **Firewall Blocks Load Balancer**
```bash
# Check current rules
sudo ufw status numbered

# Allow load balancer
sudo ufw allow from 64.23.182.28
```

### 2. **Droplet Not in Load Balancer Backend**
- Check Digital Ocean Console → Networking → Load Balancers
- Add this droplet (`102.91.98.182`) as a backend
- Health check path: `/health` on port 8000

### 3. **Wrong Load Balancer Protocol**
- Ensure load balancer forwards to port 80/443 (nginx) not 8000
- Or configure nginx to listen on port 80/443 and proxy to 8000

### 4. **Missing SSL on Load Balancer**
- Load balancer needs SSL certificate for `api.dosco.live`
- Or terminate SSL at load balancer, HTTP to backend

## Quick Fix for Testing

```bash
# 1. Temporarily update /etc/hosts for testing
echo "102.91.98.182 api.dosco.live" | sudo tee -a /etc/hosts

# 2. Install and configure nginx
sudo apt install nginx
sudo cp nginx-api.dosco.live.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/api.dosco.live.conf \
            /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 3. Test
curl -k https://api.dosco.live/health
```

## Verify Setup

1. **Server running**: `pm2 status dosco-api`
2. **Nginx running**: `systemctl status nginx`
3. **Ports listening**: `ss -tlnp | grep -E ':80|:443|:8000'`
4. **DNS correct**: `dig api.dosco.live +short`
5. **SSL working**: `curl -I https://api.dosco.live/health`
6. **CORS working**: Test from browser with localhost origin