// Shared constant-time secret comparison. Pure JS so it works in Edge
// runtime (middleware) as well as Node runtime (API routes / crons).
//
// Used by:
//   - src/middleware.ts (admin Basic Auth)
//   - src/app/api/cron/* (CRON_SECRET Bearer auth)
//   - src/lib/tenants/resolver.ts (X-Foxie-Internal-Secret check)

// Loop length is a fixed upper bound (not max of the two inputs) so wall-clock
// time does NOT vary with the lengths of either input. Secrets fit comfortably
// under 512 chars (typical HMAC hex = 64, base64 = 88, even RSA-2048 sig = 344).
const FIXED_COMPARE_LEN = 512;

export function constantTimeStringEqual(a: string, b: string): boolean {
  // Seed with 1 if lengths differ so the final result is non-zero regardless
  // of the XOR loop outcome.
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < FIXED_COMPARE_LEN; i++) {
    const ac = i < a.length ? a.charCodeAt(i) : 0;
    const bc = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ac ^ bc;
  }
  return diff === 0;
}

// True when a request carries a valid X-Foxie-Internal-Secret — i.e. it originates from a
// TRUSTED server-side bridge (the WhatsApp dispatcher / Vapi phone route), not the public
// internet. These bridges self-fetch our own API, so they all share the one Vercel egress
// IP; IP-based abuse limits are meaningless (and harmful) for them. Callers use this to skip
// the IP rate-limit bucket while keeping per-phone limits. Mirrors resolver.ts's check.
export function isTrustedInternalCall(request: Request): boolean {
  const headerSecret = request.headers.get("x-foxie-internal-secret");
  const expectedSecret = process.env.FOXIE_INTERNAL_SECRET?.trim();
  return Boolean(headerSecret && expectedSecret && constantTimeStringEqual(headerSecret, expectedSecret));
}

// Verify "Authorization: Bearer <secret>" header against an env-stored secret.
// Returns false if env unset, header missing, or mismatched.
export function verifyBearer(
  authHeader: string | null,
  expected: string | undefined,
): boolean {
  if (!expected || !authHeader) return false;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;
  return constantTimeStringEqual(authHeader.slice(prefix.length), expected);
}
