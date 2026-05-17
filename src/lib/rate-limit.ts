// Firestore-backed rate limiter. No external Redis needed.
// Granularity: per-key sliding window.
//
// Usage:
//   const { allowed } = await rateLimit("complaint:0123456789", { limit: 5, windowSeconds: 3600 });
//   if (!allowed) return 429;

import { getDb } from "./firebase-admin";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

export async function rateLimit(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const ref = getDb().collection("rate_limits").doc(sanitizeKey(key));
  const now = Date.now();
  const cutoff = now - opts.windowSeconds * 1000;

  try {
    return await getDb().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const existing = (doc.data()?.hits ?? []) as number[];
      const recent = existing.filter((t) => t > cutoff);

      if (recent.length >= opts.limit) {
        const oldestRecent = Math.min(...recent);
        const resetMs = Math.max(0, oldestRecent + opts.windowSeconds * 1000 - now);
        return {
          allowed: false,
          remaining: 0,
          resetInSeconds: Math.ceil(resetMs / 1000),
        };
      }

      recent.push(now);
      tx.set(ref, {
        hits: recent,
        updatedAt: new Date().toISOString(),
      });
      return {
        allowed: true,
        remaining: opts.limit - recent.length,
        resetInSeconds: opts.windowSeconds,
      };
    });
  } catch (err) {
    // Fail-open on Firestore errors — don't break customer experience over rate limits
    console.error("[rate-limit] error, allowing:", err);
    return { allowed: true, remaining: opts.limit, resetInSeconds: opts.windowSeconds };
  }
}

function sanitizeKey(key: string): string {
  return key.replace(/[^\w.-]/g, "_").slice(0, 200);
}

// Convenience: extract IP from request (for IP-based limits).
// SECURITY: all forwarded-for headers are comma-lists "client, proxy1, proxy2".
// The first hop is client-supplied and spoofable. The LAST hop is the closest
// trusted proxy (Vercel's edge, or our reverse proxy). We trust last hop in
// header preference order:
//   1. `x-vercel-forwarded-for` — last hop = Vercel edge's view of the client
//   2. `cf-connecting-ip` — Cloudflare-set single value, not a list
//   3. `x-real-ip` — common reverse-proxy convention, single value
//   4. `x-forwarded-for` — generic, take last hop
//   5. "unknown" fallback (still rate-limited as a single bucket)
function lastHop(headerValue: string): string | null {
  const hops = headerValue.split(",").map((s) => s.trim()).filter(Boolean);
  return hops.length > 0 ? hops[hops.length - 1] : null;
}

export function getClientIp(req: Request): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const ip = lastHop(vercel);
    if (ip) return ip;
  }

  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const ip = lastHop(xff);
    if (ip) return ip;
  }

  return "unknown";
}
