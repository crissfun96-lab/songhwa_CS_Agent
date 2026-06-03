// Date math for the day-before reservation-reminder cron, in Asia/Kuala_Lumpur.
// Pure + Firestore-free so it's unit-testable (the cron route itself uses Next/`@/`
// imports that the test runner can't load).

import { getKlNow } from "../menu/firestore";
import { normalizeTime } from "./availability";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Tomorrow's date as YYYY-MM-DD in KL. Advance the absolute instant by 24h, then read the
// KL calendar date of that instant — correct across midnight boundaries and independent of
// the server's local timezone.
export function tomorrowKlDate(now: Date = new Date()): string {
  return getKlNow(new Date(now.getTime() + ONE_DAY_MS)).date;
}

// Dates the reminder cron sweeps, in KL: [tomorrow, today]. Tomorrow is the primary
// day-before reminder; today is a same-day RETRY catching any reminder missed on the prior
// day's run (a once-daily cron has no other retry window). reminderSentAt dedups, so a
// reservation already reminded is skipped on the second pass.
export function reminderSweepDates(now: Date = new Date()): [string, string] {
  return [tomorrowKlDate(now), getKlNow(now).date];
}

// For the same-day (today) retry pass only: has this booking's time already passed in KL?
// We must not "remind" a customer about a slot that's hours gone (e.g. a 6 PM cron run
// reminding about a 12 PM lunch). Fail-safe: if the time can't be parsed, return false
// (send the reminder anyway — a possibly-late reminder beats silently dropping one).
export function reminderTimeHasPassed(reservationTime: string, nowHhmm: string): boolean {
  try {
    return normalizeTime(reservationTime) <= nowHhmm;
  } catch {
    return false;
  }
}
