# Foxie Pipecat Orchestrator (Scaffold)

A Python service that does what `services/ws-proxy` and the direct Vapi integration do — but **swappable providers** and **failover-ready**.

## Why this exists

The current setup binds web voice to Gemini Live directly. When Gemini Live breaks (and it has, multiple times in 2026), every web call fails. Pipecat lets you:

1. **Failover** — primary Gemini, fallback Groq/OpenAI when Gemini errors
2. **Per-tenant stack** — Mesolitica BM for Bahasa-heavy tenants, Gemini for English, etc.
3. **Single source of truth** — same orchestration runs web + phone + future channels
4. **Server-side API key** — fixes Bug #2 (browser key leak) AND replaces ws-proxy

## Deploy to Fly.io (Singapore region)

```bash
cd services/pipecat
fly auth login                       # one-time
fly launch --copy-config --no-deploy # accepts fly.toml
fly secrets set \
  GEMINI_API_KEY="<rotated key>" \
  DEEPGRAM_API_KEY="<your Deepgram>" \
  CARTESIA_API_KEY="<your Cartesia>"
fly deploy
# → outputs wss://foxie-pipecat.fly.dev/voice
```

Then in Vercel set:
```
NEXT_PUBLIC_WS_PROXY_URL=wss://foxie-pipecat.fly.dev/voice
```
(Same env var as the existing ws-proxy — the browser code already supports it.)

For Vapi phone integration, point Twilio Media Streams at the same wss URL.

## Current state

⚠️ **This is a SCAFFOLD.** The tool dispatcher only implements 3 of the 14 tools as examples (`get_business_status`, `search_menu`, `create_reservation`). The remaining 11 follow the same pattern from `src/app/api/vapi/route.ts` — copy them in.

When ready to put into production:
1. Implement the remaining 11 tools in `call_tool()` (1-2 hours of straight typing)
2. Add Pipecat's `FallbackAdapter` for LLM provider failover (Pipecat docs)
3. Wire Mesolitica STT for Bahasa-heavy tenants (Pipecat custom service)
4. Add metering emission on session close (POST to `/api/admin/metering` with voice_minute units)

## Local dev

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
GEMINI_API_KEY=... DEEPGRAM_API_KEY=... CARTESIA_API_KEY=... python main.py
# → listens on ws://localhost:8080/voice
```

## Migration path off ws-proxy + Vapi

Today:           Browser → ws-proxy (Node) → Gemini Live
                 Twilio  → Vapi → Gemini Live

Tomorrow:        Browser → Pipecat (Python) → STT → LLM → TTS
                 Twilio  → Pipecat → STT → LLM → TTS

Both channels share the same Pipecat orchestrator. Provider failover, per-tenant routing, server-side key — solved in one place.

## Cost projection

| Item | Per minute |
|---|---|
| Pipecat compute (fly.io performance-1x) | ~$0.0008 |
| Deepgram Nova-3 STT | ~$0.0077 |
| Gemini 2.0 Flash LLM | ~$0.001 |
| Cartesia Sonic-2 TTS | ~$0.0225 |
| **Total** | **~$0.032/min** |

vs current Gemini Live: $0.023/min (cheaper, but no failover)
vs Vapi: $0.10/min (50% more, but managed)

Pipecat is **cheaper than Vapi for the same managed feel** once you've deployed once.
