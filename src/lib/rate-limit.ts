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
// SECURITY (Bug C1 fix): the `x-forwarded-for` first-hop is set by the client and
// trivially spoofable. We trust:
//   1. `x-vercel-forwarded-for` — Vercel platform-set, not user-controllable
//   2. `cf-connecting-ip` — Cloudflare-set if proxied
//   3. `x-real-ip` — common reverse-proxy convention
//   4. Last hop of `x-forwarded-for` — the closest trusted proxy
//   5. "unknown" fallback (still rate-limited as a single bucket)
export function getClientIp(req: Request): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();

  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // LAST hop is closest to us — the only one we can trust without proxy config.
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  return "unknown";
}
