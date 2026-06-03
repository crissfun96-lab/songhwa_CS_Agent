// Channel-scoping for promos. A reservation conversation (phone / web voice / WhatsApp)
// is a DINE-IN booking, so the agent must only surface promos valid for dine_in — plus
// any promo explicitly valid on the conversation's own direct channel. This stops the
// agent quoting a third-party-only discount (Eatigo / Grab / foodpanda) that the customer
// cannot actually use when booking a table directly.

import type { PromoChannel } from "./types";

export const PROMO_CHANNELS: readonly PromoChannel[] = [
  "dine_in",
  "grab",
  "foodpanda",
  "eatigo",
  "whatsapp",
  "phone",
  "walkin",
];

export function isPromoChannel(value: unknown): value is PromoChannel {
  return typeof value === "string" && (PROMO_CHANNELS as readonly string[]).includes(value);
}

// Is this promo allowed to be surfaced in a conversation on `channel`?
//  - channel === null → no scoping (admin / raw listing): allow everything.
//  - otherwise → allow if the promo is valid for dine_in (every reservation is dine-in)
//    OR is explicitly valid on the conversation's own channel.
export function promoAllowedOnChannel(
  promo: { channels: PromoChannel[] },
  channel: PromoChannel | null,
): boolean {
  if (!channel) return true;
  return promo.channels.includes("dine_in") || promo.channels.includes(channel);
}
