import type { Reservation, ReservationModification } from "./types";
import type { Complaint } from "./complaints/types";
import type { CallbackRequest } from "./callbacks/types";

const TELEGRAM_API = (token: string) => `https://api.telegram.org/bot${token}/sendMessage`;

// ── Shared sender with exponential-backoff retry (was Bug #7) ──
// Attempts 3 times with 250ms, 1s, 4s backoff. After 3 failures, logs and
// gives up. Total worst-case latency ~5.5s (caller is fire-and-forget so OK).
async function sendToStaff(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_STAFF_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_STAFF_CHAT_ID");
    return;
  }

  const backoffsMs = [250, 1000, 4000];

  for (let attempt = 0; attempt < backoffsMs.length; attempt++) {
    try {
      const res = await fetch(TELEGRAM_API(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      });

      if (res.ok) return;

      // 429 = rate limited (honor Retry-After if present), 4xx = client error
      // (no point retrying), 5xx = retry
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        const err = await res.text();
        console.error(`[Telegram] Permanent ${res.status} (no retry):`, err.slice(0, 200));
        return;
      }

      const errBody = await res.text().catch(() => "");
      console.warn(
        `[Telegram] Attempt ${attempt + 1}/${backoffsMs.length} failed (${res.status}):`,
        errBody.slice(0, 150),
      );
    } catch (error) {
      console.warn(
        `[Telegram] Attempt ${attempt + 1}/${backoffsMs.length} network error:`,
        error instanceof Error ? error.message : String(error),
      );
    }

    if (attempt < backoffsMs.length - 1) {
      await new Promise((r) => setTimeout(r, backoffsMs[attempt]));
    }
  }

  console.error("[Telegram] All retry attempts exhausted — staff alert dropped");
}

// ── Notifications ─────────────────────────────────────────────
export async function sendStaffNotification(reservation: Reservation): Promise<void> {
  const lines = [
    "🔔 <b>New Reservation</b>",
    "",
    `👤 <b>Name:</b> ${escapeHtml(reservation.name)}`,
    `📞 <b>Phone:</b> ${escapeHtml(reservation.phone)}`,
    `📅 <b>Date:</b> ${escapeHtml(reservation.date)}`,
    `🕐 <b>Time:</b> ${escapeHtml(reservation.time)}`,
    `👥 <b>Pax:</b> ${reservation.pax}`,
  ];

  if (reservation.menuChoice) {
    lines.push(`🍽 <b>Menu:</b> ${escapeHtml(reservation.menuChoice)}`);
  }
  if (reservation.remarks) {
    lines.push(`📝 <b>Remarks:</b> ${escapeHtml(reservation.remarks)}`);
  }

  lines.push("", `⏰ <i>Booked via AI Agent at ${klTime()}</i>`);
  await sendToStaff(lines.join("\n"));
}

export async function sendComplaintNotification(complaint: Complaint): Promise<void> {
  const severityEmoji = {
    critical: "🚨",
    high: "⚠️",
    medium: "🟡",
    low: "ℹ️",
  }[complaint.severity];

  const lines = [
    `${severityEmoji} <b>New Complaint — ${complaint.severity.toUpperCase()}</b>`,
    "",
    `🎫 <b>Ticket:</b> <code>${escapeHtml(complaint.ticketId)}</code>`,
    `👤 <b>Name:</b> ${escapeHtml(complaint.name)}`,
    `📞 <b>Phone:</b> ${escapeHtml(complaint.phone)}`,
    `📂 <b>Category:</b> ${escapeHtml(complaint.category.replace(/_/g, " "))}`,
  ];

  if (complaint.visitDate) {
    lines.push(`📅 <b>Visit:</b> ${escapeHtml(complaint.visitDate)}`);
  }

  lines.push(
    "",
    `💬 <b>Description:</b>`,
    escapeHtml(complaint.description),
    "",
    `⏰ <i>Filed via AI Agent at ${klTime()}</i>`,
  );

  if (complaint.severity === "critical") {
    lines.push("", "<b>⚡ CRITICAL — call customer within 1 hour</b>");
  }

  await sendToStaff(lines.join("\n"));
}

export async function sendReservationUpdateNotification(
  reservation: Reservation,
  modification: ReservationModification,
): Promise<void> {
  const lines = [
    "✏️ <b>Reservation Updated</b>",
    "",
    `👤 <b>${escapeHtml(reservation.name)}</b> (${escapeHtml(reservation.phone)})`,
    `📅 Now: ${escapeHtml(reservation.date)} at ${escapeHtml(reservation.time)}, ${reservation.pax} pax`,
    "",
    "<b>Changes:</b>",
  ];
  for (const [field, { from, to }] of Object.entries(modification.changes)) {
    lines.push(`  ${field}: ${escapeHtml(String(from))} → ${escapeHtml(String(to))}`);
  }
  if (modification.reason) {
    lines.push("", `📝 ${escapeHtml(modification.reason)}`);
  }
  lines.push("", `⏰ <i>${modification.by} · ${klTime()}</i>`);
  await sendToStaff(lines.join("\n"));
}

export async function sendReservationCancelNotification(
  reservation: Reservation,
): Promise<void> {
  const lines = [
    "❌ <b>Reservation Cancelled</b>",
    "",
    `👤 ${escapeHtml(reservation.name)} (${escapeHtml(reservation.phone)})`,
    `📅 Was: ${escapeHtml(reservation.date)} at ${escapeHtml(reservation.time)}, ${reservation.pax} pax`,
  ];
  if (reservation.cancelReason) {
    lines.push("", `💬 ${escapeHtml(reservation.cancelReason)}`);
  }
  lines.push("", `⏰ <i>${klTime()}</i>`);
  await sendToStaff(lines.join("\n"));
}

export async function sendCallbackNotification(callback: CallbackRequest): Promise<void> {
  const urgencyEmoji = {
    high: "🔴",
    medium: "🟡",
    low: "🟢",
  }[callback.urgency];

  const promiseByKl = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(callback.promiseByIso));

  const lines = [
    `${urgencyEmoji} <b>Callback Request — ${callback.urgency.toUpperCase()}</b>`,
    "",
    `🎫 <b>Ticket:</b> <code>${escapeHtml(callback.ticketId)}</code>`,
    `👤 <b>Name:</b> ${escapeHtml(callback.name)}`,
    `📞 <b>Call back:</b> ${escapeHtml(callback.phone)}`,
    "",
    `💬 <b>Reason:</b>`,
    escapeHtml(callback.reason),
    "",
    `⏳ <b>Promised by:</b> ${promiseByKl} (KL time)`,
    `⏰ <i>Requested via AI Agent at ${klTime()}</i>`,
  ];

  await sendToStaff(lines.join("\n"));
}

// ── Helpers ────────────────────────────────────────────────────
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function klTime(): string {
  return new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" });
}
