// Meta WhatsApp Business Cloud API client.
// Use this for CUSTOMER-FACING messages (booking confirmations, reminders,
// inbound conversation handling). Staff group notifications stay on
// Baileys (services/wa-notifier/) because Meta Cloud API doesn't send to groups.

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

  await sendText(r.phone, body);
}

export async function sendBookingReminder(r: Reservation): Promise<void> {
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
    console.warn("[Meta WA] template fallback to text:", err);
    await sendText(
      r.phone,
      `Reminder: your Songhwa booking is tomorrow — ${r.date} at ${r.time}, ${r.pax} pax. See you!`,
    );
  }
}
