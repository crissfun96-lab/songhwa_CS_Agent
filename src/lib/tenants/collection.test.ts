import { describe, it, expect } from "vitest";
import { tc } from "./collection";
import { DEFAULT_TENANT_ID } from "./types";
import { menuCollections } from "../menu/firestore";

// Tenant isolation is the load-bearing multi-tenancy primitive: the DEFAULT tenant
// (Songhwa) must keep its EXACT existing collection names (zero migration), while any
// other tenant must get its OWN namespace and never collide with Songhwa's data.

describe("tc() — default tenant keeps existing names verbatim", () => {
  it("returns the legacy songhwa_* names for business collections", () => {
    expect(tc(DEFAULT_TENANT_ID, "reservations")).toBe("songhwa_reservations");
    expect(tc(DEFAULT_TENANT_ID, "customers")).toBe("songhwa_customers");
    expect(tc(DEFAULT_TENANT_ID, "complaints")).toBe("songhwa_complaints");
  });

  it("keeps the wa_* ops collections un-prefixed for the default tenant", () => {
    expect(tc(DEFAULT_TENANT_ID, "inbound_messages")).toBe("wa_inbound_messages");
    expect(tc(DEFAULT_TENANT_ID, "conversation_history")).toBe("wa_conversation_history");
    expect(tc(DEFAULT_TENANT_ID, "notification_queue")).toBe("wa_notification_queue");
    expect(tc(DEFAULT_TENANT_ID, "conversations")).toBe("wa_conversations");
  });
});

describe("tc() — a second tenant gets its own namespace", () => {
  it("substitutes the songhwa_ prefix with the tenant id", () => {
    expect(tc("acme", "reservations")).toBe("acme_reservations");
    expect(tc("acme", "customers")).toBe("acme_customers");
  });

  it("namespaces the wa_* ops collections with a <tid>_wa_ infix", () => {
    expect(tc("acme", "inbound_messages")).toBe("acme_wa_inbound_messages");
    expect(tc("acme", "conversation_history")).toBe("acme_wa_conversation_history");
    expect(tc("acme", "notification_queue")).toBe("acme_wa_notification_queue");
  });

  it("lowercases the tenant id", () => {
    expect(tc("ACME", "reservations")).toBe("acme_reservations");
  });

  it("ISOLATION INVARIANT: two different tenants never share a collection name, and neither collides with Songhwa", () => {
    const cols = [
      "reservations", "customers", "complaints", "callbacks",
      "inbound_messages", "conversation_history", "notification_queue",
    ] as const;
    for (const c of cols) {
      const songhwa = tc(DEFAULT_TENANT_ID, c);
      const acme = tc("acme", c);
      const beta = tc("beta", c);
      expect(acme).not.toBe(songhwa);
      expect(beta).not.toBe(songhwa);
      expect(acme).not.toBe(beta);
    }
  });
});

describe("tc() — fails safe on bad input", () => {
  it("falls back to the default tenant for a non-conforming slug (never emits a malformed name)", () => {
    // Invalid slugs must resolve to Songhwa's names, not produce "bad!_reservations".
    expect(tc("bad!", "reservations")).toBe("songhwa_reservations");
    expect(tc("has space", "reservations")).toBe("songhwa_reservations");
    expect(tc("-leadingdash", "reservations")).toBe("songhwa_reservations");
    expect(tc("a".repeat(41), "reservations")).toBe("songhwa_reservations"); // > 40 chars
  });

  it("treats an empty tenant id as the default tenant", () => {
    expect(tc("", "reservations")).toBe("songhwa_reservations");
  });
});

describe("menuCollections() — same isolation contract for the menu layer", () => {
  it("returns songhwa_* menu names for the default tenant", () => {
    const c = menuCollections(DEFAULT_TENANT_ID);
    expect(c.menuItems).toBe("songhwa_menu_items");
    expect(c.menuSets).toBe("songhwa_menu_sets");
    expect(c.promos).toBe("songhwa_promos");
    expect(c.faqs).toBe("songhwa_faqs");
    expect(c.examples).toBe("songhwa_voice_examples");
    expect(c.summary).toBe("songhwa_menu_cache");
    expect(c.syncStatus).toBe("songhwa_sync_status");
  });

  it("namespaces every menu collection for a second tenant", () => {
    const c = menuCollections("acme");
    expect(c.menuItems).toBe("acme_menu_items");
    expect(c.menuSets).toBe("acme_menu_sets");
    expect(c.promos).toBe("acme_promos");
    expect(c.faqs).toBe("acme_faqs");
    expect(c.examples).toBe("acme_voice_examples");
    expect(c.summary).toBe("acme_menu_cache");
    expect(c.syncStatus).toBe("acme_sync_status");
  });

  it("lowercases and fails safe to the default on a bad slug", () => {
    expect(menuCollections("ACME").menuItems).toBe("acme_menu_items");
    expect(menuCollections("bad!").menuItems).toBe("songhwa_menu_items");
    expect(menuCollections("").menuItems).toBe("songhwa_menu_items");
  });
});
