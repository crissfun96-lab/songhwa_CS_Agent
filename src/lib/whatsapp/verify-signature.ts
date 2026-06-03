// Meta WhatsApp webhook signature verification.
//
// Extracted from the webhook route so the crypto can be unit-tested without
// HTTP plumbing. The core (`isValidMetaSignature`) is PURE — the app secret is
// passed in, so tests are deterministic and env-free. The route uses the thin
// `verifyMetaSignature` wrapper, which reads the secret from the environment.
//
// SECURITY: no dev-mode bypass. If the secret isn't configured, verification
// MUST fail — accepting unsigned payloads in any environment would let an
// attacker stuff wa_inbound_messages (Firestore cost) and poison agent logic.

import crypto from "node:crypto";

/**
 * Verify a Meta `X-Hub-Signature-256` header against the raw request body.
 *
 * @param rawBody   the exact raw request body string Meta signed
 * @param signature the `X-Hub-Signature-256` header value (`sha256=<hex>`), or null
 * @param appSecret the Meta app secret; if missing/empty, verification fails closed
 */
export function isValidMetaSignature(
  rawBody: string,
  signature: string | null | undefined,
  appSecret: string | undefined,
): boolean {
  if (!appSecret) return false; // not configured → refuse all signed POSTs
  if (!signature || !signature.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signature.slice("sha256=".length);
  try {
    // Constant-time compare. Buffers must be equal length or timingSafeEqual throws —
    // the catch covers malformed/odd-length hex in the provided signature.
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(provided, "hex"),
    );
  } catch {
    return false;
  }
}

/** Route-facing wrapper: reads the app secret from the environment. */
export function verifyMetaSignature(rawBody: string, signature: string | null): boolean {
  return isValidMetaSignature(rawBody, signature, process.env.META_WHATSAPP_APP_SECRET?.trim());
}
