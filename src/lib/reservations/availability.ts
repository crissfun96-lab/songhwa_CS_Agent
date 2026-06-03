// Availability check — prevents double-booking AND detects idempotent duplicates.
//
// Turn-time capacity model: a booking at T occupies the dining room for its WHOLE
// table turn [T, T+turn) (lunch 90m, dinner 120m). A slot is available iff the PEAK
// concurrent pax across the new booking's window stays within the service cap. This
// replaces the old per-30-min-bucket model, which let a 7pm party "free" its seats at
// 7:30 and oversell a single service many times over.
// Caps + turn times are per-tenant (admin-editable, stored on the tenant doc) with the
// values below as defaults — so Songhwa's behavior is unchanged when nothing is set.

import { getDb } from "../firebase-admin";
import { tc } from "../tenants/collection";
import { DEFAULT_TENANT_ID } from "../tenants/types";
import { getTenant } from "../tenants/firestore";
import type { Reservation } from "../types";
import { resolveDate } from "./date-resolver";

// Per-service capacity + table-turn configuration.
export interface CapacityConfig {
  lunchCap: number;            // 11:30–15:00 — max concurrent pax
  dinnerCap: number;           // 17:30–22:00
  lunchTurnMinutes: number;    // how long a lunch table stays occupied
  dinnerTurnMinutes: number;   // dinner sits longer
}

// Songhwa's original hardcoded values — the default when a tenant sets no override.
export const DEFAULT_CAPACITY: CapacityConfig = {
  lunchCap: 80,
  dinnerCap: 100,
  lunchTurnMinutes: 90,
  dinnerTurnMinutes: 120,
};

// Merge a tenant's (possibly partial / untrusted) overrides onto the defaults,
// field-by-field. Each value must be a positive finite number, else the default for
// that field stands — so one bad/missing field never breaks the whole capacity model.
export function sanitizeCapacity(
  raw: Partial<CapacityConfig> | null | undefined,
): CapacityConfig {
  const pick = (v: unknown, d: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : d;
  return {
    lunchCap: pick(raw?.lunchCap, DEFAULT_CAPACITY.lunchCap),
    dinnerCap: pick(raw?.dinnerCap, DEFAULT_CAPACITY.dinnerCap),
    lunchTurnMinutes: pick(raw?.lunchTurnMinutes, DEFAULT_CAPACITY.lunchTurnMinutes),
    dinnerTurnMinutes: pick(raw?.dinnerTurnMinutes, DEFAULT_CAPACITY.dinnerTurnMinutes),
  };
}

// Resolve the effective capacity config for a tenant (reads the cached tenant doc).
// Falls back to defaults on any error / missing tenant — capacity must never throw.
export async function resolveCapacityConfig(
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<CapacityConfig> {
  try {
    const tenant = await getTenant(tenantId);
    return sanitizeCapacity(tenant?.capacity);
  } catch {
    return { ...DEFAULT_CAPACITY };
  }
}

// ── Time helpers ───────────────────────────────────────────────
function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Turn length for the service the slot belongs to. Non-lunch defaults to the
// (longer) dinner turn — the conservative choice for any out-of-band stored data.
function turnMinutesForSlot(hhmm: string, config: CapacityConfig): number {
  return isLunchSlot(hhmm) ? config.lunchTurnMinutes : config.dinnerTurnMinutes;
}

// A reservation's occupancy interval in minutes-since-midnight.
interface Occupancy {
  startMin: number;
  endMin: number;
  pax: number;
}

// Build occupancy intervals from a day's reservations — excludes cancelled, the
// reservation being moved (on update), and any row whose stored time won't parse
// (bad data must not silently block new bookings).
function toOccupancies(
  dayReservations: Reservation[],
  excludeReservationId: string | undefined,
  config: CapacityConfig,
): Occupancy[] {
  const out: Occupancy[] = [];
  for (const r of dayReservations) {
    if (r.status === "cancelled") continue;
    if (excludeReservationId && r.id === excludeReservationId) continue;
    let hhmm: string;
    try {
      hhmm = normalizeTime(r.time);
    } catch {
      continue;
    }
    // A stored time outside both services can't occupy a real service window — skip
    // it so phantom/legacy rows never consume lunch/dinner capacity (else a bogus
    // 16:00 row would bleed into the 17:30 dinner window via the dinner-turn default).
    if (!isLunchSlot(hhmm) && !isDinnerSlot(hhmm)) continue;
    const startMin = hhmmToMinutes(hhmm);
    out.push({
      startMin,
      endMin: startMin + turnMinutesForSlot(hhmm, config),
      // Clamp corrupt pax: a negative value is truthy in JS and would SUBTRACT from
      // the concurrent count, masking a full room; NaN/undefined coerce to 0.
      pax: Math.max(0, r.pax || 0),
    });
  }
  return out;
}

// Peak concurrent existing pax across the window [winStart, winEnd).
// Occupancy only ever RISES at an interval's start, so the peak within the window
// occurs at winStart (intervals already running) or at some existing start inside it.
// This is true peak occupancy — NOT a naive sum of everyone who overlaps the window,
// which would double-count back-to-back seatings that never actually co-occur.
function peakConcurrentPax(active: Occupancy[], winStart: number, winEnd: number): number {
  const instants = [winStart];
  for (const o of active) {
    if (o.startMin > winStart && o.startMin < winEnd) instants.push(o.startMin);
  }
  let peak = 0;
  for (const t of instants) {
    let total = 0;
    for (const o of active) {
      if (o.startMin <= t && t < o.endMin) total += o.pax;
    }
    if (total > peak) peak = total;
  }
  return peak;
}

function normalizeTime(time: string): string {
  // Accept "7 PM", "7:00 PM", "19:00", "7:30pm" → "HH:MM" 24h
  const cleaned = time.trim().toLowerCase().replace(/\s+/g, "");
  const pm = cleaned.includes("pm");
  const am = cleaned.includes("am");
  const core = cleaned.replace(/[ap]m/g, "");
  const [hStr, mStr = "00"] = core.includes(":")
    ? core.split(":")
    : [core, "00"];
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid time format: "${time}"`);
  }
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isPastDate(date: string): boolean {
  // Today (or future) in KL timezone → not past
  const klTodayFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of klTodayFmt.formatToParts(new Date())) parts[p.type] = p.value;
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return date < today;
}

function isLunchSlot(hhmm: string): boolean {
  return hhmm >= "11:30" && hhmm < "15:00";
}

function isDinnerSlot(hhmm: string): boolean {
  return hhmm >= "17:30" && hhmm < "22:00";
}

// `booked` = PEAK concurrent pax during the requested table turn (not a 30-min
// bucket count); `remaining` = cap − booked (seats addable without breaching the cap).
export type AvailabilityCheck =
  | {
      available: true;
      capacityAtSlot: { booked: number; remaining: number; total: number };
    }
  | {
      available: false;
      reason: "outside_hours" | "fully_booked" | "invalid_time";
      capacityAtSlot?: { booked: number; remaining: number; total: number };
      alternatives: Array<{ date: string; time: string; note: string }>;
    };

// ── Main availability check ──────────────────────────────────
export async function checkAvailability(
  rawDate: string,       // YYYY-MM-DD or natural language ("Saturday April 25")
  requestedTime: string, // anything-like
  pax: number,
  excludeReservationId?: string, // when re-checking for an update, exclude the current booking
  tenantId: string = DEFAULT_TENANT_ID,
  // Optional pre-resolved capacity. Transaction callers resolve ONCE and pass the same
  // snapshot to both the pre-check and the in-txn re-check; other callers let us resolve.
  config?: CapacityConfig,
): Promise<AvailabilityCheck> {
  // Defensive: a non-positive / non-finite party size is invalid input. The HTTP
  // boundaries (POST Zod, GET route) already validate this, but the reschedule path
  // does not — guard here so bad pax can never silently pass the capacity math.
  if (!Number.isFinite(pax) || pax < 1) {
    return { available: false, reason: "invalid_time", alternatives: [] };
  }

  // Resolve the date FIRST — Firestore stores canonical YYYY-MM-DD keys, so a
  // free-form date ("Saturday April 25") must be normalized before ANY query.
  // Unparseable dates reuse the existing `invalid_time` reason (keeps the union).
  const resolved = resolveDate(rawDate);
  if (!resolved.ok) {
    return {
      available: false,
      reason: "invalid_time",
      alternatives: [],
    };
  }
  const date = resolved.date;

  let hhmm: string;
  try {
    hhmm = normalizeTime(requestedTime);
  } catch {
    return {
      available: false,
      reason: "invalid_time",
      alternatives: [],
    };
  }

  const isLunch = isLunchSlot(hhmm);
  const isDinner = isDinnerSlot(hhmm);

  if (!isLunch && !isDinner) {
    return {
      available: false,
      reason: "outside_hours",
      alternatives: [
        { date, time: "12:30 PM", note: "Lunch slot" },
        { date, time: "7:00 PM", note: "Dinner slot" },
      ],
    };
  }

  // Block past-date availability checks — no point reserving a slot that already happened
  if (isPastDate(date)) {
    return {
      available: false,
      reason: "invalid_time",
      alternatives: [],
    };
  }

  // Resolve the tenant's capacity config (or use the snapshot the caller passed).
  const capacity = config ?? (await resolveCapacityConfig(tenantId));
  const cap = isLunch ? capacity.lunchCap : capacity.dinnerCap;
  const winStart = hhmmToMinutes(hhmm);
  const winEnd = winStart + turnMinutesForSlot(hhmm, capacity);

  // Fetch all reservations for this date
  const snapshot = await getDb()
    .collection(tc(tenantId, "reservations"))
    .where("date", "==", date)
    .get();

  const dayReservations = snapshot.docs.map((d) => d.data() as Reservation);

  // Peak concurrent pax during the new booking's table turn — EXCLUDE cancelled +
  // exclude self (on update). Uses the SAME helpers as the in-transaction re-check.
  const active = toOccupancies(dayReservations, excludeReservationId, capacity);
  const bookedPeak = peakConcurrentPax(active, winStart, winEnd);
  const remaining = cap - bookedPeak;

  if (remaining < pax) {
    // Suggest nearby slots — pass the SAME resolved config to avoid re-reads + drift.
    const alternatives = await suggestAlternatives(date, hhmm, pax, isLunch, tenantId, capacity);
    return {
      available: false,
      reason: "fully_booked",
      capacityAtSlot: { booked: bookedPeak, remaining, total: cap },
      alternatives,
    };
  }

  return {
    available: true,
    capacityAtSlot: { booked: bookedPeak, remaining, total: cap },
  };
}

// Find nearby slots with capacity
async function suggestAlternatives(
  date: string,
  hhmm: string,
  pax: number,
  isLunch: boolean,
  tenantId: string,
  config: CapacityConfig,
): Promise<Array<{ date: string; time: string; note: string }>> {
  const candidates = isLunch
    ? ["11:30", "12:00", "12:30", "13:00", "13:30", "14:00"]
    : ["17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00"];

  const suggestions: Array<{ date: string; time: string; note: string }> = [];

  for (const candidate of candidates) {
    if (candidate === hhmm) continue; // both are normalized "HH:MM"
    const check = await checkAvailability(date, candidate, pax, undefined, tenantId, config);
    if (check.available) {
      suggestions.push({
        date,
        time: formatDisplay(candidate),
        // remaining is cap − peak BEFORE this party; subtract pax so the note reflects
        // what's left AFTER seating them (remaining ≥ pax here since check.available).
        note: `${check.capacityAtSlot.remaining - pax} seats open`,
      });
    }
    if (suggestions.length >= 3) break;
  }

  return suggestions;
}

function formatDisplay(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${String(m).padStart(2, "0")} ${period}`;
}

// ── Capacity check for use INSIDE a Firestore transaction ────
// Takes already-fetched reservation data + returns whether adding `pax` at `time`
// would exceed capacity. Reuses the SAME turn-time peak-occupancy logic as
// checkAvailability to guarantee the in-transaction re-check matches the pre-check.
export function isCapacityExceeded(
  dayReservations: Reservation[],
  requestedTime: string,
  pax: number,
  excludeReservationId?: string,
  config: CapacityConfig = DEFAULT_CAPACITY,
): boolean {
  if (!Number.isFinite(pax) || pax < 1) return true; // invalid party size → exceeded (defensive)

  let hhmm: string;
  try {
    hhmm = normalizeTime(requestedTime);
  } catch {
    return true; // invalid time = treat as exceeded (caller already validated, defensive)
  }

  const isLunch = isLunchSlot(hhmm);
  const isDinner = isDinnerSlot(hhmm);
  if (!isLunch && !isDinner) return true; // outside hours

  const cap = isLunch ? config.lunchCap : config.dinnerCap;
  const winStart = hhmmToMinutes(hhmm);
  const winEnd = winStart + turnMinutesForSlot(hhmm, config);

  // Same turn-time peak-occupancy model + SAME config as checkAvailability — keeping the
  // two in lockstep is what closes the TOCTOU window between pre-check and committed write.
  const active = toOccupancies(dayReservations, excludeReservationId, config);
  const bookedPeak = peakConcurrentPax(active, winStart, winEnd);

  return bookedPeak + pax > cap;
}

// ── Idempotency: detect duplicate booking attempts ────────────
// Prevents the same customer from accidentally booking twice in a single session
export async function findRecentDuplicate(
  phone: string,
  rawDate: string,
  time: string,
  windowMinutes: number = 60,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<Reservation | null> {
  // Resolve to canonical YYYY-MM-DD before the exact-string `date ==` query —
  // otherwise a free-form date never matches a stored "2026-04-25" key and the
  // duplicate guard silently does nothing.
  const resolved = resolveDate(rawDate);
  if (!resolved.ok) return null;
  const date = resolved.date;

  const snapshot = await getDb()
    .collection(tc(tenantId, "reservations"))
    .where("phone", "==", phone)
    .where("date", "==", date)
    .get();

  const normalizedTime = normalizeTime(time);
  const cutoff = Date.now() - windowMinutes * 60 * 1000;

  const match = snapshot.docs
    .map((d) => d.data() as Reservation)
    .find((r) => {
      try {
        // A cancelled reservation should NOT block re-booking
        if (r.status === "cancelled") return false;
        return (
          normalizeTime(r.time) === normalizedTime &&
          new Date(r.createdAt).getTime() > cutoff
        );
      } catch {
        return false;
      }
    });

  return match ?? null;
}

// Export helpers for route handlers
export { normalizeTime, isLunchSlot, isDinnerSlot };
