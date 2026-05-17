// Resolve which tenant a request belongs to.
// Resolution order:
//   1. X-Foxie-Tenant header (explicit, used by Vapi/WA dispatchers)
//   2. Subdomain (e.g. `acme.foxie-cs.com` → "acme")
//   3. Falls back to DEFAULT_TENANT_ID ("songhwa") for backwards compat

import { DEFAULT_TENANT_ID } from "./types";

const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "admin", "foxie", "business", "songhwa-cs-agent",
]);

export function resolveTenantId(request: Request): string {
  const headerTenant = request.headers.get("x-foxie-tenant")?.trim().toLowerCase();
  if (headerTenant && isValidSlug(headerTenant)) return headerTenant;

  try {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    // Skip localhost / Vercel preview hosts
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
