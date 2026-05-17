// Reservation lifecycle: find, update, cancel. Used by BOTH agent and admin.

import { getDb } from "../firebase-admin";
import { tc } from "../tenants/collection";
import { DEFAULT_TENANT_ID } from "../tenants/types";
import type {
  Reservation,
  ReservationModification,
} from "../types";
import { checkAvailability, normalizeTime } from "./availability";

// ── Normalize phone for matching ──────────────────────────────
// Canonical form: always starts with "0" (Malaysian mobile format).
// Handles: +60 prefix, spaces, dashes, int'l, and 10- or 11-digit numbers.
// Examples:
//   "+60 11-5430 2561" → "0115430 2561" stripped → "01154302561"
//   "011-5430 2561"    → "01154302561"
//   "0123456789"       → "0123456789"
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D+/g, "").replace(/^60/, "");
  return digits.startsWith("0") ? digits : "0" + digits;
}

// ── Find reservations by phone ────────────────────────────────
export interface FindQuery {
  phone: string;
  date?: string;
  activeOnly?: boolean;
  tenantId?: string;
}

export async function findReservationsByPhone(
  query: FindQuery,
): Promise<Reservation[]> {
  const needle = normalizePhone(query.phone);
  const tid = query.tenantId ?? DEFAULT_TENANT_ID;
  const collection = tc(tid, "reservations");

  // Query by indexed phoneNormalized field (see backfill migration).
  // Falls back to raw phone match for old records that predate the index.
  const [byIndex, byRaw] = await Promise.all([
    getDb()
      .collection(collection)
      .where("phoneNormalized", "==", needle)
      .get(),
    // Fallback: still scan records with no phoneNormalized field
    getDb()
      .collection(collection)
      .where("phone", "==", query.phone)
      .get(),
  ]);

  const seen = new Set<string>();
  const merged: Reservation[] = [];
  for (const doc of [...byIndex.docs, ...byRaw.docs]) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    const r = doc.data() as Reservation;
    // Double-check with normalization for the raw-phone fallback
    if (normalizePhone(r.phone) !== needle) continue;
    if (query.date && r.date !== query.date) continue;
    if (query.activeOnly && r.status === "cancelled") continue;
    merged.push(r);
  }

  return merged.sort((a, b) =>
    (a.date + " " + a.time).localeCompare(b.date + " " + b.time),
  );
}

// ── Update reservation ────────────────────────────────────────
export interface UpdateInput {
  id: string;
  updatedBy: "agent" | "admin" | "customer";
  actor?: string;
  reason?: string;
  changes: Partial<Pick<Reservation, "date" | "time" | "pax" | "menuChoice" | "remarks" | "name">>;
  skipAvailabilityCheck?: boolean;
  tenantId?: string;
}

export type UpdateResult =
  | { success: true; reservation: Reservation; modification: ReservationModification }
  | {
      success: false;
      error: string;
      code: "not_found" | "cancelled" | "fully_booked" | "outside_hours" | "invalid_time" | "past_reservation" | "no_changes";
      alternatives?: Array<{ date: string; time: string; note: string }>;
    };

export async function updateReservation(input: UpdateInput): Promise<UpdateResult> {
  const db = getDb();
  const tid = input.tenantId ?? DEFAULT_TENANT_ID;
  const ref = db.collection(tc(tid, "reservations")).doc(input.id);
  const doc = await ref.get();

  if (!doc.exists) {
    return { success: false, error: "Reservation not found", code: "not_found" };
  }

  const current = doc.data() as Reservation;
  if (current.status === "cancelled") {
    return { success: false, error: "Reservation is already cancelled", code: "cancelled" };
  }

  // Block modifying reservations that already passed
  const reservationKey = `${current.date} ${current.time}`;
  if (isInPast(current.date, current.time)) {
    return {
      success: false,
      error: "Cannot modify a past reservation",
      code: "past_reservation",
    };
  }

  // Block updates that would MOVE the reservation into the past
  const newDate = input.changes.date ?? current.date;
  const newTime = input.changes.time ?? current.time;
  if (isInPast(newDate, newTime)) {
    return {
      success: false,
      error: "Cannot move reservation to a past date/time",
      code: "past_reservation",
    };
  }

  // Build the diff
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const newState: Reservation = { ...current };

  for (const [key, newValue] of Object.entries(input.changes)) {
    if (newValue === undefined || newValue === null || newValue === "") continue;
    const oldValue = (current as unknown as Record<string, unknown>)[key];
    if (oldValue === newValue) continue;
    changes[key] = { from: oldValue, to: newValue };
    (newState as unknown as Record<string, unknown>)[key] = newValue;
  }

  if (Object.keys(changes).length === 0) {
    return { success: false, error: "No changes provided", code: "no_changes" };
  }

  // If date/time/pax changed, re-check availability (unless explicitly skipped)
  if (!input.skipAvailabilityCheck) {
    const timeChanged = "date" in changes || "time" in changes;
    const paxChanged = "pax" in changes;
    if (timeChanged || paxChanged) {
      // Exclude this reservation from its own capacity count — it's being moved
      const avail = await checkAvailability(
        newState.date,
        newState.time,
        newState.pax,
        input.id,
        tid,
      );
      if (!avail.available) {
        return {
          success: false,
          error:
            avail.reason === "fully_booked"
              ? `That slot is full. Try: ${avail.alternatives.map((a) => `${a.date} ${a.time}`).join(", ")}`
              : avail.reason === "outside_hours"
                ? "Requested time is outside our operating hours"
                : "Invalid time format",
          code: avail.reason,
          alternatives: avail.alternatives,
        };
      }
    }
  }

  const modification: ReservationModification = {
    at: new Date().toISOString(),
    by: input.updatedBy,
    ...(input.actor && { actor: input.actor }),
    changes,
    ...(input.reason && { reason: input.reason }),
  };

  const updated: Reservation = {
    ...newState,
    modifications: [...(current.modifications ?? []), modification],
    updatedAt: modification.at,
    status: current.status ?? "confirmed",
  };

  await ref.set(updated);

  // Log for observability
  console.log(
    `[lifecycle] updated ${input.id}: ${Object.keys(changes).join(", ")} (was ${reservationKey})`,
  );

  return { success: true, reservation: updated, modification };
}

// ── Cancel reservation ────────────────────────────────────────
export interface CancelInput {
  id: string;
  cancelledBy: "agent" | "admin" | "customer";
  actor?: string;
  reason?: string;
  tenantId?: string;
}

export type CancelResult =
  | { success: true; reservation: Reservation }
  | { success: false; error: string; code: "not_found" | "already_cancelled" | "past_reservation" };

export async function cancelReservation(input: CancelInput): Promise<CancelResult> {
  const db = getDb();
  const tid = input.tenantId ?? DEFAULT_TENANT_ID;
  const ref = db.collection(tc(tid, "reservations")).doc(input.id);
  const doc = await ref.get();
  if (!doc.exists) {
    return { success: false, error: "Reservation not found", code: "not_found" };
  }
  const current = doc.data() as Reservation;
  if (current.status === "cancelled") {
    return { success: false, error: "Already cancelled", code: "already_cancelled" };
  }
  if (isInPast(current.date, current.time)) {
    return {
      success: false,
      error: "Cannot cancel a past reservation",
      code: "past_reservation",
    };
  }

  const now = new Date().toISOString();
  const modification: ReservationModification = {
    at: now,
    by: input.cancelledBy,
    ...(input.actor && { actor: input.actor }),
    changes: { status: { from: current.status ?? "confirmed", to: "cancelled" } },
    ...(input.reason && { reason: input.reason }),
  };

  const updated: Reservation = {
    ...current,
    status: "cancelled",
    cancelledAt: now,
    cancelReason: input.reason ?? "Customer requested cancellation",
    modifications: [...(current.modifications ?? []), modification],
    updatedAt: now,
  };

  await ref.set(updated);
  console.log(`[lifecycle] cancelled ${input.id} (was ${current.date} ${current.time})`);
  return { success: true, reservation: updated };
}

// ── Helper: is this reservation in the past? (KL time) ────────
function isInPast(date: string, time: string): boolean {
  try {
    const hhmm = normalizeTime(time);
    const [h, m] = hhmm.split(":").map(Number);

    // Build KL time now
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    const nowHhmm = `${parts.hour}:${parts.minute}`;

    if (date < today) return true;
    if (date === today) {
      const resMinutes = h * 60 + m;
      const [nowH, nowM] = nowHhmm.split(":").map(Number);
      const nowMinutes = nowH * 60 + nowM;
      return resMinutes < nowMinutes;
    }
    return false;
  } catch {
    return false;
  }
}

export function formatReservationSummary(r: Reservation): string {
  const base = `${r.date} at ${r.time}, ${r.pax} pax, under ${r.name}`;
  const menu = r.menuChoice ? ` (${r.menuChoice})` : "";
  const status = r.status === "cancelled" ? " [CANCELLED]" : "";
  return base + menu + status;
}
