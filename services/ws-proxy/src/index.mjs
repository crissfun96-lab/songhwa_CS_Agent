// Songhwa Gemini Live WebSocket Proxy
//
// Fixes Bug #2 (API-key-leak-to-browser) from the SaaS-readiness audit.
//
// Architecture:
//   Browser → wss://this-proxy/live → upstream wss://generativelanguage.googleapis.com/...
//   The proxy holds GEMINI_API_KEY in env and forwards messages in both directions.
//   The browser never sees the API key.
//
// Optional next step: when migrating to Pipecat (see voice-stack-alternatives.md),
// this proxy becomes redundant — Pipecat absorbs its role + adds provider abstraction.

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT ?? 8080);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
const GEMINI_MODEL_ENDPOINT =
  process.env.GEMINI_MODEL_ENDPOINT?.trim() ||
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "https://songhwa-cs-agent.vercel.app,http://localhost:3000,http://localhost:3001")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!GEMINI_API_KEY) {
  console.error("FATAL: GEMINI_API_KEY env var not set");
  process.exit(1);
}

// ── HTTP server for health checks (and WS upgrade) ────────────
const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "songhwa-ws-proxy", uptime: process.uptime() }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

// ── Per-IP rate limit (simple in-memory leaky bucket) ─────────
const ipBuckets = new Map(); // ip → { count, resetAt }
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30; // 30 new sessions per IP per minute

function rateLimitOk(ip) {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count++;
  return true;
}

// ── WebSocket server ──────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin ?? "";
  if (ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
    console.warn(`[upgrade] blocked origin: ${origin}`);
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  const ip = (req.headers["x-forwarded-for"]?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown").trim();
  if (!rateLimitOk(ip)) {
    console.warn(`[upgrade] rate-limited ip: ${ip}`);
    socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    socket.destroy();
    return;
  }

  if (req.url !== "/live") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    handleClient(clientWs, ip);
  });
});

function handleClient(clientWs, ip) {
  const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[${sessionId}] new session from ${ip}`);

  // Open upstream Gemini Live socket with API key
  const upstreamUrl = `${GEMINI_MODEL_ENDPOINT}?key=${GEMINI_API_KEY}`;
  const upstream = new WebSocket(upstreamUrl);

  let clientClosed = false;
  let upstreamClosed = false;
  const closeBoth = (code, reason) => {
    if (!clientClosed) {
      try { clientWs.close(code, reason); } catch { /* ignore */ }
    }
    if (!upstreamClosed) {
      try { upstream.close(code, reason); } catch { /* ignore */ }
    }
  };

  upstream.on("open", () => {
    console.log(`[${sessionId}] upstream open`);
  });

  upstream.on("message", (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  upstream.on("close", (code, reason) => {
    upstreamClosed = true;
    console.log(`[${sessionId}] upstream closed: ${code} ${reason?.toString().slice(0, 80)}`);
    closeBoth(1011, "upstream closed");
  });

  upstream.on("error", (err) => {
    console.error(`[${sessionId}] upstream error:`, err.message);
    closeBoth(1011, "upstream error");
  });

  clientWs.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else {
      // Drop messages until upstream is ready (typical for first ~100ms)
    }
  });

  clientWs.on("close", (code, reason) => {
    clientClosed = true;
    console.log(`[${sessionId}] client closed: ${code} ${reason?.toString().slice(0, 80)}`);
    closeBoth(1000, "client closed");
  });

  clientWs.on("error", (err) => {
    console.error(`[${sessionId}] client error:`, err.message);
    closeBoth(1011, "client error");
  });
}

server.listen(PORT, () => {
  console.log(`🦊 Songhwa WS Proxy listening on :${PORT}`);
  console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`   Upstream: ${GEMINI_MODEL_ENDPOINT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});

// Clean shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`\n[shutdown] ${sig} received, closing...`);
    wss.clients.forEach((c) => c.close(1001, "server shutdown"));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  });
}
