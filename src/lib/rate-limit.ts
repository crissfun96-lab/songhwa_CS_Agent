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

// Convenience: extract IP from request (for IP-based limits)
export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
