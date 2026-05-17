import { NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * POST /api/songhwa-token
 * Returns Gemini Live session credentials.
 *
 * Strategy:
 *   1. Try ephemeral token (preferred — short-lived, single-use).
 *   2. If Google's authTokens endpoint is 404/unavailable for this tier:
 *      - If STRICT_TOKEN_MODE=true → return 503. Caller must use ws-proxy
 *        (services/ws-proxy/). Set this once the proxy is deployed.
 *      - Else → return the API key, gated by origin allowlist + 10/hr/IP
 *        rate limit. Tightened from 60/hr to shrink scraping surface.
 *
 * Permanent fix: deploy services/ws-proxy/ to Fly.io and flip STRICT_TOKEN_MODE.
 */

const ALLOWED_ORIGINS = new Set([
  "https://songhwa-cs-agent.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
]);

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured" },
      { status: 500 },
    );
  }

  const now = Date.now();
  const expireTime = new Date(now + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 2 * 60 * 1000).toISOString();

  // ── Attempt 1: ephemeral token ───────────────────────────────
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1alpha/authTokens?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uses: 1, expireTime, newSessionExpireTime }),
      },
    );
    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({ token: data.name });
    }
    // Log but fall through to apiKey path
    const errorBody = await response.text().catch(() => "");
    console.warn(
      `[songhwa-token] Ephemeral unavailable (${response.status}); using API key fallback:`,
      errorBody.slice(0, 150),
    );
  } catch (err) {
    console.warn("[songhwa-token] Ephemeral network error; falling back:", err);
  }

  // ── Attempt 2: API key fallback (only if STRICT_TOKEN_MODE not set) ──
  // SECURITY (was Bug #2.5): the old `referer.startsWith(o)` check was bypassable
  // via `https://songhwa-cs-agent.vercel.app.evil.com/...`. We now parse the
  // referer as a URL and compare origins exactly.
  if (process.env.STRICT_TOKEN_MODE === "true") {
    return NextResponse.json(
      { error: "Voice service temporarily unavailable. Please retry shortly." },
      { status: 503 },
    );
  }
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  let refererOrigin: string | null = null;
  if (referer) {
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      refererOrigin = null;
    }
  }

  const isOriginAllowed =
    (origin && ALLOWED_ORIGINS.has(origin)) ||
    (refererOrigin !== null && ALLOWED_ORIGINS.has(refererOrigin));

  if (!isOriginAllowed) {
    console.warn("[songhwa-token] Blocked fallback — unknown origin:", origin, referer);
    return NextResponse.json(
      { error: "Unable to issue session token from this origin." },
      { status: 403 },
    );
  }

  // Rate limit: cap key issuance per IP to prevent scraping (was 60/hr).
  // Tighter cap shrinks the window an attacker has to harvest the key while
  // Google's ephemeral endpoint is degraded.
  const ip = getClientIp(request);
  const limit = await rateLimit(`token-fallback:${ip}`, { limit: 10, windowSeconds: 3600 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many session token requests. Please wait." },
      { status: 429, headers: { "Retry-After": String(limit.resetInSeconds) } },
    );
  }

  return NextResponse.json({ apiKey });
}
