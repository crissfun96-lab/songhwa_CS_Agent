import { describe, it, expect } from "vitest";
import { isPromoChannel, promoAllowedOnChannel } from "./promo-channel";

// Bug this guards (P1 truthfulness): getActivePromos never filtered by channel, so a
// reservation conversation (phone / web voice / WhatsApp) could surface — and the agent
// could quote — a promo that is ONLY valid on a third-party platform (Eatigo / Grab /
// foodpanda). A reservation IS a dine-in booking, so the agent must only mention promos
// valid for dine_in (or explicitly valid on the conversation's own direct channel).

describe("isPromoChannel", () => {
  it("accepts the known channels", () => {
    for (const c of ["dine_in", "grab", "foodpanda", "eatigo", "whatsapp", "phone", "walkin"]) {
      expect(isPromoChannel(c)).toBe(true);
    }
  });
  it("rejects unknown / junk", () => {
    expect(isPromoChannel("web")).toBe(false);
    expect(isPromoChannel("")).toBe(false);
    expect(isPromoChannel(null)).toBe(false);
    expect(isPromoChannel("DINE_IN")).toBe(false);
  });
});

describe("promoAllowedOnChannel", () => {
  it("no channel (null) → unscoped, always allowed (admin/raw use)", () => {
    expect(promoAllowedOnChannel({ channels: ["eatigo"] }, null)).toBe(true);
  });

  it("THE FIX: a third-party-only promo is hidden from a dine-in reservation channel", () => {
    expect(promoAllowedOnChannel({ channels: ["eatigo"] }, "whatsapp")).toBe(false);
    expect(promoAllowedOnChannel({ channels: ["grab", "foodpanda"] }, "phone")).toBe(false);
    expect(promoAllowedOnChannel({ channels: ["eatigo"] }, "dine_in")).toBe(false);
  });

  it("a dine_in promo is always allowed in a reservation conversation (it IS a dine-in booking)", () => {
    expect(promoAllowedOnChannel({ channels: ["dine_in"] }, "whatsapp")).toBe(true);
    expect(promoAllowedOnChannel({ channels: ["dine_in"] }, "phone")).toBe(true);
    expect(promoAllowedOnChannel({ channels: ["dine_in"] }, "dine_in")).toBe(true);
  });

  it("a channel-exclusive promo shows on its own channel", () => {
    expect(promoAllowedOnChannel({ channels: ["whatsapp"] }, "whatsapp")).toBe(true);
    expect(promoAllowedOnChannel({ channels: ["phone"] }, "phone")).toBe(true);
    // ...but not on a different direct channel
    expect(promoAllowedOnChannel({ channels: ["whatsapp"] }, "phone")).toBe(false);
  });

  it("a promo valid both on a platform AND dine_in still shows (it's genuinely valid dine-in)", () => {
    expect(promoAllowedOnChannel({ channels: ["eatigo", "dine_in"] }, "phone")).toBe(true);
  });
});
