// Meta WhatsApp Business Cloud API client.
// Use this for CUSTOMER-FACING messages (booking confirmations, reminders,
// inbound conversation handling). Staff group notifications stay on
// Baileys (services/wa-notifier/) because Meta Cloud API doesn't send to groups.

import { log } from "@/lib/logger";
import type { Reservation } from "@/lib/types";

const META_API_BASE = "https://graph.facebook.com/v22.0";

interface MetaSendResponse {
  messaging_product: "whatsapp";
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string; message_status?: string }>;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} not configured`);
  return v;
}

// True only when BOTH Meta WA credentials are present. Customer-facing helpers
// no-op gracefully when this is false, so a missing-config deploy never throws
// or blocks the booking flow.
export function isMetaWaConfigured(): boolean {
  return Boolean(
    process.env.META_WHATSAPP_PHONE_ID?.trim() &&
      process.env.META_WHATSAPP_TOKEN?.trim(),
  );
}

// Normalize MY phone to WhatsApp wa_id format (E.164 without leading +)
// Accepts: "0123456789", "+60123456789", "60123456789", "012-3456789"
export function toWaId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("60")) return digits;
  if (digits.startsWith("0")) return `60${digits.slice(1)}`;
  return digits;
}

// ── Send a free-form text message (only allowed inside 24h customer window) ──
export async function sendText(toPhone: string, body: string): Promise<MetaSendResponse> {
  const phoneId = requireEnv("META_WHATSAPP_PHONE_ID");
  const token = requireEnv("META_WHATSAPP_TOKEN");

  const res = await fetch(`${META_API_BASE}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWaId(toPhone),
      type: "text",
      text: { preview_url: false, body: body.slice(0, 4096) },
    }),
  });

  const data = (await res.json()) as MetaSendResponse;
  if (!res.ok || data.error) {
    throw new Error(
      `Meta WA send failed (${res.status}): ${data.error?.message ?? "unknown"}`,
    );
  }
  return data;
}

// ── Send a template message (allowed OUTSIDE 24h window — requires approved template) ──
export async function sendTemplate(
  toPhone: string,
  templateName: string,
  languageCode: string = "en_US",
  components?: Array<{
    type: "header" | "body" | "button";
    parameters: Array<{ type: "text"; text: string }>;
  }>,
): Promise<MetaSendResponse> {
  const phoneId = requireEnv("META_WHATSAPP_PHONE_ID");
  const token = requireEnv("META_WHATSAPP_TOKEN");

  const res = await fetch(`${META_API_BASE}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toWaId(toPhone),
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components && { components }),
      },
    }),
  });

  const data = (await res.json()) as MetaSendResponse;
  if (!res.ok || data.error) {
    throw new Error(
      `Meta WA template failed (${res.status}): ${data.error?.message ?? "unknown"}`,
    );
  }
  return data;
}

// ── High-level helpers ──

export async function sendBookingConfirmation(r: Reservation): Promise<void> {
  // Env-guard: no Meta WA config → no-op (never throw, never block the booking).
  if (!isMetaWaConfigured()) {
    log.warn({ event: "meta_wa_confirmation_skipped_unconfigured" });
    return;
  }

  const body = [
    `Hi ${r.name}, your booking at Songhwa Korean Cuisine is confirmed.`,
    "",
    `📅 ${r.date} at ${r.time}`,
    `👥 ${r.pax} pax`,
    r.menuChoice ? `🍽 ${r.menuChoice}` : null,
    "",
    `📍 Level 8, Millerz Square, Old Klang Road, KL`,
    `📞 +60 11-5430 2561`,
    "",
    "See you soon! Reply CANCEL to cancel this booking.",
  ]
    .filter(Boolean)
    .join("\n");

  // 24-HOUR WINDOW RULE: a phone/voice booking has no open WhatsApp customer
  // window, so free-form text gets rejected by Meta. TRY an approved template
  // first (mirrors sendBookingReminder), then FALL BACK to free-form text —
  // which succeeds for in-window bookings (e.g. customers who messaged on WA).
  try {
    await sendTemplate(r.phone, "booking_confirmation", "en_US", [
      {
        type: "body",
        parameters: [
          { type: "text", text: r.name },
          { type: "text", text: `${r.date} at ${r.time}` },
          { type: "text", text: String(r.pax) },
        ],
      },
    ]);
  } catch (err) {
    log.warn({ event: "meta_wa_confirmation_template_fallback_to_text", err });
    try {
      await sendText(r.phone, body);
    } catch (fallbackErr) {
      // Both template + text failed (Meta down / outside 24h window). Notification
      // only — never throw so callers can await this directly without a .catch().
      log.error({ event: "meta_wa_confirmation_text_fallback_failed", err: fallbackErr });
    }
  }
}

export async function sendBookingReminder(r: Reservation): Promise<void> {
  // Env-guard: no Meta WA config → no-op (never throw).
  if (!isMetaWaConfigured()) {
    log.warn({ event: "meta_wa_reminder_skipped_unconfigured" });
    return;
  }

  // For messages > 24h after last customer contact, must use approved template
  // Falls back to plain text if template not configured
  try {
    await sendTemplate(r.phone, "booking_reminder", "en_US", [
      {
        type: "body",
        parameters: [
          { type: "text", text: r.name },
          { type: "text", text: `${r.date} at ${r.time}` },
          { type: "text", text: String(r.pax) },
        ],
      },
    ]);
  } catch (err) {
    log.warn({ event: "meta_wa_reminder_template_fallback_to_text", err });
    await sendText(
      r.phone,
      `Reminder: your Songhwa booking is tomorrow — ${r.date} at ${r.time}, ${r.pax} pax. See you!`,
    );
  }
}
