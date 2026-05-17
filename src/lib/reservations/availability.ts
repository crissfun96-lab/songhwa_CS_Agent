// Availability check — prevents double-booking AND detects idempotent duplicates.
// Simple capacity model: per-30-min bucket, hard cap at lunch + dinner.
// Chris can tune caps later based on real table layout.

import { getDb } from "../firebase-admin";
import type { Reservation } from "../types";

const RESERVATION_COLLECTION = "songhwa_reservations";

// Capacity rules — tune these per Chris's real floor plan
const CAPACITY = {
  lunchCap: 80,       // 11:30–15:00 — max concurrent pax
  dinnerCap: 100,     // 17:30–22:00
  bucketMinutes: 30,  // time-slot granularity
};

// ── Bucket a time into 30-min slot ────────────────────────────
function timeToBucket(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const bucketStart = Math.floor(m / CAPACITY.bucketMinutes) * CAPACITY.bucketMinutes;
  return `${String(h).padStart(2, "0")}:${String(bucketStart).padStart(2, "0")}`;
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
  date: string,          // YYYY-MM-DD
  requestedTime: string, // anything-like
  pax: number,
  excludeReservationId?: string, // when re-checking for an update, exclude the current booking
): Promise<AvailabilityCheck> {
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

  const bucket = timeToBucket(hhmm);
  const cap = isLunch ? CAPACITY.lunchCap : CAPACITY.dinnerCap;

  // Fetch all reservations for this date
  const snapshot = await getDb()
    .collection(RESERVATION_COLLECTION)
    .where("date", "==", date)
    .get();

  const dayReservations = snapshot.docs.map((d) => d.data() as Reservation);

  // Sum pax in matching bucket — EXCLUDE cancelled + exclude self (on update)
  const bookedInBucket = dayReservations
    .filter((r) => {
      if (r.status === "cancelled") return false;
      if (excludeReservationId && r.id === excludeReservationId) return false;
      try {
        return timeToBucket(normalizeTime(r.time)) === bucket;
      } catch {
        return false;
      }
    })
    .reduce((sum, r) => sum + (r.pax || 0), 0);

  const remaining = cap - bookedInBucket;

  if (remaining < pax) {
    // Suggest nearby slots
    const alternatives = await suggestAlternatives(date, hhmm, pax, isLunch);
    return {
      available: false,
      reason: "fully_booked",
      capacityAtSlot: { booked: bookedInBucket, remaining, total: cap },
      alternatives,
    };
  }

  return {
    available: true,
    capacityAtSlot: { booked: bookedInBucket, remaining, total: cap },
  };
}

// Find nearby slots with capacity
async function suggestAlternatives(
  date: string,
  hhmm: string,
  pax: number,
  isLunch: boolean,
): Promise<Array<{ date: string; time: string; note: string }>> {
  const candidates = isLunch
    ? ["11:30", "12:00", "12:30", "13:00", "13:30", "14:00"]
    : ["17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00"];

  const suggestions: Array<{ date: string; time: string; note: string }> = [];

  for (const candidate of candidates) {
    if (candidate === timeToBucket(hhmm)) continue;
    const check = await checkAvailability(date, candidate, pax);
    if (check.available) {
      suggestions.push({
        date,
        time: formatDisplay(candidate),
        note: `${check.capacityAtSlot.remaining} seats open`,
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
// would exceed capacity. Reuses the SAME bucket logic as checkAvailability to
// guarantee the in-transaction re-check matches the pre-transaction check.
export function isCapacityExceeded(
  dayReservations: Reservation[],
  requestedTime: string,
  pax: number,
  excludeReservationId?: string,
): boolean {
  let hhmm: string;
  try {
    hhmm = normalizeTime(requestedTime);
  } catch {
    return true; // invalid time = treat as exceeded (caller already validated, defensive)
  }

  const isLunch = isLunchSlot(hhmm);
  const isDinner = isDinnerSlot(hhmm);
  if (!isLunch && !isDinner) return true; // outside hours

  const bucket = timeToBucket(hhmm);
  const cap = isLunch ? CAPACITY.lunchCap : CAPACITY.dinnerCap;

  const bookedInBucket = dayReservations
    .filter((r) => {
      if (r.status === "cancelled") return false;
      if (excludeReservationId && r.id === excludeReservationId) return false;
      try {
        return timeToBucket(normalizeTime(r.time)) === bucket;
      } catch {
        return false;
      }
    })
    .reduce((sum, r) => sum + (r.pax || 0), 0);

  return bookedInBucket + pax > cap;
}

// ── Idempotency: detect duplicate booking attempts ────────────
// Prevents the same customer from accidentally booking twice in a single session
export async function findRecentDuplicate(
  phone: string,
  date: string,
  time: string,
  windowMinutes: number = 60,
): Promise<Reservation | null> {
  const snapshot = await getDb()
    .collection(RESERVATION_COLLECTION)
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
