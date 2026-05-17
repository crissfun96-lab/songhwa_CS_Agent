// Collection-name resolver — the safest multi-tenancy primitive.
// Songhwa's existing collections stay as-is (no migration needed).
// New tenants get their own prefix: `acme_reservations`, etc.
//
// Usage:
//   const reservationsRef = db.collection(tc(tenantId, "reservations"));

import { DEFAULT_TENANT_ID } from "./types";

// The collection short-names we use across the app
export type CollectionName =
  | "reservations"
  | "reservation_drafts"
  | "customers"
  | "complaints"
  | "callbacks"
  | "handoffs"
  | "menu_items"
  | "menu_sets"
  | "promos"
  | "faqs"
  | "menu_summary"
  | "business_info"
  | "dish_photos"
  | "conversation_history"
  | "inbound_messages"
  | "notification_queue"
  | "conversations";

// Maps short name → existing Songhwa collection name (preserves DB state).
// New tenants substitute `songhwa_` with their tenant id.
const SONGHWA_NAMES: Record<CollectionName, string> = {
  reservations:         "songhwa_reservations",
  reservation_drafts:   "songhwa_reservation_drafts",
  customers:            "songhwa_customers",
  complaints:           "songhwa_complaints",
  callbacks:            "songhwa_callbacks",
  handoffs:             "songhwa_handoffs",
  menu_items:           "songhwa_menu_items",
  menu_sets:            "songhwa_menu_sets",
  promos:               "songhwa_promos",
  faqs:                 "songhwa_faqs",
  menu_summary:         "songhwa_menu_summary",
  business_info:        "songhwa_business_info",
  dish_photos:          "songhwa_dish_photos",
  conversation_history: "wa_conversation_history",
  inbound_messages:     "wa_inbound_messages",
  notification_queue:   "wa_notification_queue",
  conversations:        "wa_conversations",
};

// Defense-in-depth: validate tenantId format before constructing collection
// names. This is normally enforced by `resolveTenantId()` upstream, but
// `tc()` is also called by internal code paths that may not run through the
// resolver. An invalid slug falls back to the default tenant (Songhwa).
function isValidSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(s);
}

/**
 * Resolve the Firestore collection name for a tenant.
 *
 * - Default tenant (Songhwa): returns the existing collection names verbatim.
 * - Other tenants: substitutes the `songhwa_` prefix with `<tenantId>_`, and
 *   `wa_*` collections become `<tenantId>_wa_*` (the `_wa_` infix is
 *   INTENTIONAL — it preserves the namespace separation between business
 *   data and WhatsApp ops state).
 *
 * Examples:
 *   tc("songhwa", "reservations")     → "songhwa_reservations"      (legacy)
 *   tc("acme", "reservations")        → "acme_reservations"         (new tenant)
 *   tc("acme", "inbound_messages")    → "acme_wa_inbound_messages"  (WA ops)
 *   tc("invalid!", "reservations")    → "songhwa_reservations"      (default fallback)
 */
export function tc(tenantId: string, name: CollectionName): string {
  const tid = (tenantId || DEFAULT_TENANT_ID).toLowerCase();
  const base = SONGHWA_NAMES[name];
  // Fall back to default tenant on any non-conforming slug. Never produce
  // malformed collection names from caller-supplied input.
  if (tid === DEFAULT_TENANT_ID || !isValidSlug(tid)) return base;
  return base.replace(/^songhwa_/, `${tid}_`).replace(/^wa_/, `${tid}_wa_`);
}

// For places that aggregate across all tenants (admin cross-tenant analytics).
// Returns the collection group name (sub-collection model only — currently unused
// since we're using flat prefixed collections for now).
export function isMultiTenantCollection(name: CollectionName): boolean {
  return !["business_info"].includes(name);
}
