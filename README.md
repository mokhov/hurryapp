# Hurrytrain API Stub

Modern Node.js starter on `Fastify + TypeScript` without frontend frameworks.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Server starts on `http://localhost:3000`.

Useful endpoints:
- `GET /`
- `GET /health`

## Production build

```bash
npm run build
npm start
```

## Deploy options

- **Render**: `render.yaml` is included for Blueprint deploy.
- **Railway**: `railway.json` is included; just connect repo and deploy.
- **Any Docker cloud** (Fly.io, GCP Cloud Run, AWS ECS): use provided `Dockerfile`.
- **Timeweb**: see `DEPLOY_TIMEWEB.md` (VPS with PM2, API + 2 bots).
