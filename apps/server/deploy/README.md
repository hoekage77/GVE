# Backend Droplet Runbook

This backend is meant to run behind Nginx on a DigitalOcean droplet and be managed by PM2.

## What runs where

- Nginx listens on `80` and `443`.
- PM2 runs the Node backend on port `8000`.
- The backend persists session data locally under `.data/sessions`.
- No `DATABASE_URL` is required in the current backend setup.

## Start the backend with PM2

From the repo root on the droplet:

```bash
cd /home/kage/visualruntime
npm install
```

Copy the example env file and fill in the secrets. The backend loader reads `apps/server/server/.env` automatically:

```bash
cp apps/server/deploy/droplet.env.example apps/server/server/.env
```

Then start the backend:

```bash
cd apps/server
pm2 start deploy/ecosystem.config.cjs
pm2 status
pm2 logs dosco-api
```

## Keep it alive across reboots

After the process is up:

```bash
pm2 save
pm2 startup systemd -u root --hp /root
```

Run the `pm2 startup` command that PM2 prints back to you, then verify:

```bash
pm2 status
ss -tulpn | grep 8000
```

## Restart after config changes

If you update `apps/server/server/.env` or deploy new code:

```bash
cd /home/kage/visualruntime/apps/server
pm2 restart dosco-api --update-env
```

## Nginx check

The Nginx site should proxy `api.dosco.live` to `http://127.0.0.1:8000`.
If you change the config, reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```