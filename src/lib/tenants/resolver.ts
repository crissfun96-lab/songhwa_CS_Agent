// Resolve which tenant a request belongs to.
// Resolution order:
//   1. X-Foxie-Tenant header — ONLY honored when accompanied by a matching
//      X-Foxie-Internal-Secret. Used by trusted server-side callers
//      (Vapi bridge, WA dispatcher) that need to forward a tenant context
//      across an internal hop.
//   2. Subdomain (e.g. `acme.foxie-cs.com` → "acme")
//   3. Falls back to DEFAULT_TENANT_ID ("songhwa") for backwards compat
//
// SECURITY: until v1, the X-Foxie-Tenant header was unauthenticated. Any
// attacker could spoof another tenant by sending that header. Now requires
// FOXIE_INTERNAL_SECRET env to be set + match. If the env is unset the
// header path is disabled entirely (subdomain-only resolution).

import { DEFAULT_TENANT_ID } from "./types";
import { constantTimeStringEqual } from "@/lib/auth-secret";

const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "admin", "foxie", "business", "songhwa-cs-agent", "wa",
]);

export function resolveTenantId(request: Request): string {
  const headerTenant = request.headers.get("x-foxie-tenant")?.trim().toLowerCase();
  const headerSecret = request.headers.get("x-foxie-internal-secret");
  const expectedSecret = process.env.FOXIE_INTERNAL_SECRET?.trim();

  if (headerTenant && isValidSlug(headerTenant) && expectedSecret && headerSecret) {
    if (constantTimeStringEqual(headerSecret, expectedSecret)) return headerTenant;
    // Wrong secret with a tenant header set — silently fall through to subdomain.
    // We don't 401 because the header is optional and may be set by misconfigured
    // proxies; the legitimate path is subdomain-only for those callers.
  }

  try {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    // Skip localhost / Vercel preview hosts / raw IPs
    if (host === "localhost" || host.endsWith(".vercel.app") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      return DEFAULT_TENANT_ID;
    }
    const sub = host.split(".")[0];
    if (sub && !RESERVED_SUBDOMAINS.has(sub) && isValidSlug(sub)) return sub;
  } catch {
    // bad URL — fall through
  }

  return DEFAULT_TENANT_ID;
}

function isValidSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(s);
}
