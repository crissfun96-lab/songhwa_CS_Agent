// WhatsApp notification queue — Vercel enqueues, Mac mini Baileys service drains.
//
// Flow:
//   1. Vercel API writes { type, message, target } to `wa_notification_queue` collection
//   2. Mac mini service listens via Firestore onSnapshot
//   3. Service formats + sends via Baileys → marks `sentAt`
//
// This decouples the serverless Vercel runtime from the long-running WA session.

import { getDb } from "./firebase-admin";
import type { Reservation, ReservationModification } from "./types";

const QUEUE_COLLECTION = "wa_notification_queue";

export type WaNotificationType =
  | "new_reservation"
  | "reservation_update"
  | "reservation_cancel"
  | "complaint"
  | "callback";

export interface WaQueueItem {
  id: string;
  type: WaNotificationType;
  message: string;
  target: string;          // group name to match (e.g., "Songhwa Reservations")
  createdAt: string;
  attempts: number;
  sentAt: string | null;
  error: string | null;
  metadata?: Record<string, unknown>;
}

const TARGET_GROUP = "Songhwa Reservations";

async function enqueue(
  type: WaNotificationType,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // SAFETY: Skip WhatsApp queue in non-production environments so dev/test
  // runs don't spam the real Songhwa Reservations group. Override with
  // WA_FORCE=1 when intentionally testing the WA channel itself.
  if (process.env.NODE_ENV !== "production" && process.env.WA_FORCE !== "1") {
    console.log(`[wa-queue] SKIPPED in dev (${type}): set WA_FORCE=1 to override`);
    return;
  }

  const id = `wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const item: WaQueueItem = {
    id,
    type,
    message,
    target: TARGET_GROUP,
    createdAt: new Date().toISOString(),
    attempts: 0,
    sentAt: null,
    error: null,
    ...(metadata && { metadata }),
  };
  await getDb().collection(QUEUE_COLLECTION).doc(id).set(item);
}

// ── Message formatters (WhatsApp markdown: *bold*, _italic_) ──
function klTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export async function enqueueNewReservation(r: Reservation): Promise<void> {
  const lines = [
    "🔔 *New Reservation* (AI Agent)",
    "",
    `👤 ${r.name}`,
    `📞 ${r.phone}`,
    `📅 ${r.date} at ${r.time}`,
    `👥 ${r.pax} pax`,
  ];
  if (r.menuChoice) lines.push(`🍽 ${r.menuChoice}`);
  if (r.remarks) lines.push(`📝 ${r.remarks}`);
  lines.push("", `_Booked ${klTime(r.createdAt)}_`);

  await enqueue("new_reservation", lines.join("\n"), { reservationId: r.id });
}

export async function enqueueReservationUpdate(
  r: Reservation,
  mod: ReservationModification,
): Promise<void> {
  const lines = [
    "✏️ *Reservation Updated*",
    "",
    `👤 ${r.name} (${r.phone})`,
    `📅 Now: ${r.date} at ${r.time}, ${r.pax} pax`,
    "",
    "*Changes:*",
  ];
  for (const [field, { from, to }] of Object.entries(mod.changes)) {
    lines.push(`  • ${field}: ${from} → ${to}`);
  }
  if (mod.reason) lines.push("", `_Reason: ${mod.reason}_`);
  lines.push(`_By ${mod.by} · ${klTime()}_`);

  await enqueue("reservation_update", lines.join("\n"), { reservationId: r.id });
}

export async function enqueueReservationCancel(r: Reservation): Promise<void> {
  const lines = [
    "❌ *Reservation Cancelled*",
    "",
    `👤 ${r.name} (${r.phone})`,
    `📅 Was: ${r.date} at ${r.time}, ${r.pax} pax`,
  ];
  if (r.cancelReason) lines.push("", `💬 ${r.cancelReason}`);
  lines.push("", `_${klTime()}_`);

  await enqueue("reservation_cancel", lines.join("\n"), { reservationId: r.id });
}
