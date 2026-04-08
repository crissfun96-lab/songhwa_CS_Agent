import type { Reservation } from "./types";

export async function sendStaffNotification(reservation: Reservation): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_STAFF_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_STAFF_CHAT_ID");
    return;
  }

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

  lines.push("", `⏰ <i>Booked via AI Agent at ${new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}</i>`);

  const text = lines.join("\n");

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[Telegram] Send failed:", err);
    }
  } catch (error) {
    console.error("[Telegram] Network error:", error);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
