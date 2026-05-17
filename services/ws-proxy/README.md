# Songhwa Gemini WS Proxy

**Fixes Bug #2** from the SaaS-readiness audit: the browser was holding the raw `GEMINI_API_KEY` because Google's ephemeral-token endpoint 404s for some account tiers. This proxy holds the key on the server side and forwards Gemini Live WebSocket traffic.

## Architecture

```
Browser  ─────►  WS Proxy  ─────►  Gemini Live (with API key)
         ◄─────            ◄─────
```

- Browser connects to `wss://<your-proxy-host>/live`
- Proxy authenticates the request (origin allowlist + per-IP rate limit)
- Proxy opens upstream Gemini Live WebSocket with the API key
- All messages pipe bidirectionally — no protocol translation
- The API key never leaves the proxy server

## Deployment options (pick one)

### Option 1 — Fly.io (recommended)

Free Hobby plan covers 1 shared-cpu VM in Singapore (≤50ms to KL).

```bash
cd services/ws-proxy
npm install
fly auth login                       # one-time
fly launch --copy-config --no-deploy # accepts fly.toml
fly secrets set \
  GEMINI_API_KEY="$(grep GEMINI_API_KEY ../../.env.local | cut -d= -f2 | tr -d '"')" \
  ALLOWED_ORIGINS=https://songhwa-cs-agent.vercel.app,http://localhost:3000
fly deploy
# → outputs wss://songhwa-ws-proxy.fly.dev
```

Then in Vercel set:
```
NEXT_PUBLIC_WS_PROXY_URL=wss://songhwa-ws-proxy.fly.dev/live
```
Redeploy main app.

### Option 2 — Mac mini + Cloudflare Tunnel (cheapest)

If you already have `cloudflared` set up:

```bash
cd services/ws-proxy
npm install
cp .env.example .env  # edit and add GEMINI_API_KEY
pm2 start src/index.mjs --name songhwa-ws-proxy
pm2 save

# Expose via Cloudflare Tunnel (free)
cloudflared tunnel --url http://localhost:8080
# Or with a named tunnel + custom domain:
cloudflared tunnel create songhwa-ws
cloudflared tunnel route dns songhwa-ws ws.songhwa-cs-agent.com
cloudflared tunnel run --url http://localhost:8080 songhwa-ws
```

Caveats: Mac mini = single point of failure. Home internet quality affects voice latency. Acceptable for Songhwa-only MVP, NOT for paying tenants.

### Option 3 — Railway / Render

Standard Docker deploy. Use the included `Dockerfile`. Set env vars in dashboard:
- `GEMINI_API_KEY`
- `ALLOWED_ORIGINS`

Cost: $5-7/month depending on plan.

## Wiring the main app

Add to `.env.local` and to Vercel env vars:

```
NEXT_PUBLIC_WS_PROXY_URL=wss://your-proxy-host/live
```

The main app's `src/app/page.tsx` checks this env var. If set, it bypasses `/api/songhwa-token` and connects directly to the proxy.

If unset, the app falls back to the current (vulnerable) Gemini-direct mode.

## Local development

```bash
cd services/ws-proxy
npm install
cp .env.example .env  # add your GEMINI_API_KEY
npm run dev
# → 🦊 Songhwa WS Proxy listening on :8080
```

Then in the main app:
```
NEXT_PUBLIC_WS_PROXY_URL=ws://localhost:8080/live
```

## Verification

```bash
# Health check
curl http://localhost:8080/health
# → {"ok":true,"service":"songhwa-ws-proxy","uptime":12.3}

# Try to connect from disallowed origin (should fail with 403)
wscat -c ws://localhost:8080/live -H "Origin: https://evil.com"

# Connect from allowed origin (should pipe to Gemini)
wscat -c ws://localhost:8080/live -H "Origin: http://localhost:3000"
```

## Monitoring

- Fly.io: built-in dashboard at https://fly.io/apps/songhwa-ws-proxy
- Logs: `fly logs` or `pm2 logs songhwa-ws-proxy`
- Each session logs: connect IP, upstream connect, message direction, close code

## Cost ceiling

At Songhwa MVP volume (~50 calls/day, avg 3 min each = 150 min/day = ~$0.50/mo Gemini cost):
- Fly.io: free (under free tier)
- Mac mini: $0
- Railway: $5/mo

When PaaS scales to 100s of calls/day, migrate to Pipecat (`docs/plans/voice-stack-alternatives.md`) — Pipecat absorbs this proxy's role AND adds provider abstraction.

## What this does NOT do

- ❌ Per-tenant API key routing (build this with Pipecat)
- ❌ Provider abstraction (Pipecat does this)
- ❌ Cost tracking per session (Pipecat does this)
- ❌ Failover to OpenAI/Mesolitica (Pipecat does this)

This is a tactical fix for Bug #2 specifically. Long-term: Pipecat.
