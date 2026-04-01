# Deploy on Timeweb

This project has 4 long-running processes:
- web app (`Fastify`)
- `NextMetroEkbBot` Telegram bot
- `NextMetroSamaraBot` Telegram bot
- `NextMetroOmskBot` Telegram bot

The most practical way on Timeweb is a VPS + PM2.

## 1) Create VPS

- Create a Linux VPS in Timeweb (Ubuntu 22.04/24.04 is fine).
- Point your domain to the VPS IP (A record), if needed.

## 2) Server bootstrap

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs
sudo npm i -g pm2
```

## 3) Clone and install app

```bash
git clone <YOUR_REPO_URL> hurrytrain
cd hurrytrain
npm ci
```

## 4) Configure environment

Create `.env` in project root:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000

NEXT_METRO_EKB_BOT_TOKEN=your_ekb_bot_token
NEXT_METRO_SAMARA_BOT_TOKEN=your_samara_bot_token
NEXT_METRO_OMSK_BOT_TOKEN=your_omsk_bot_token
```

## 5) Build and run all processes

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Check status/logs:

```bash
pm2 status
pm2 logs hurrytrain-web
pm2 logs next-metro-ekb-bot
pm2 logs next-metro-samara-bot
pm2 logs next-metro-omsk-bot
```

## 6) Put Nginx in front of Node

Create config `/etc/nginx/sites-available/hurrytrain`:

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/hurrytrain /etc/nginx/sites-enabled/hurrytrain
sudo nginx -t
sudo systemctl reload nginx
```

## 7) Enable HTTPS (recommended)

```bash
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN
```

## Update release flow

```bash
cd hurrytrain
git pull
npm ci
npm run build
pm2 restart all
```

## Notes

- Telegram bots use polling mode, so no webhook setup is required.
- If one bot token is invalid, only that PM2 process will fail; others keep working.
