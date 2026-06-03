import { describe, it, expect } from "vitest";
import { reminderSweepDates, reminderTimeHasPassed } from "./reminder-schedule";

// The reminder cron used to query only `date == tomorrow`. If a send failed in its single
// daily window, reminderSentAt was never set and the booking's date was never == tomorrow
// again → the reminder was PERMANENTLY lost. The fix sweeps BOTH tomorrow and today (today
// catches a reminder missed on the prior day's run, as a same-day reminder). These tests pin
// the KL-timezone date computation — tomorrow first (priority), today second, always distinct.

describe("reminderSweepDates (Asia/Kuala_Lumpur)", () => {
  it("returns [tomorrow, today] in KL time", () => {
    // 2026-06-04T04:00Z = 12:00 KL Thursday June 4
    expect(reminderSweepDates(new Date("2026-06-04T04:00:00Z"))).toEqual([
      "2026-06-05",
      "2026-06-04",
    ]);
  });

  it("respects the KL offset across the UTC midnight boundary", () => {
    // 2026-06-04T17:00Z = 01:00 KL Friday June 5
    expect(reminderSweepDates(new Date("2026-06-04T17:00:00Z"))).toEqual([
      "2026-06-06",
      "2026-06-05",
    ]);
  });

  it("always yields two distinct dates with tomorrow exactly one day after today (year boundary)", () => {
    const [tomorrow, today] = reminderSweepDates(new Date("2026-12-31T05:00:00Z"));
    expect(today).toBe("2026-12-31");
    expect(tomorrow).toBe("2027-01-01");
    expect(tomorrow).not.toBe(today);
  });
});

// On the same-day retry pass we must NOT "remind" about a slot that already passed (a 6 PM
// cron reminding a customer about their 12 PM lunch). Used only on the today pass.
describe("reminderTimeHasPassed", () => {
  it("is true when the booking time is before now (already passed)", () => {
    expect(reminderTimeHasPassed("12:00 PM", "18:00")).toBe(true); // noon lunch, now 6 PM
    expect(reminderTimeHasPassed("17:30", "18:00")).toBe(true);
  });
  it("is false when the booking time is still ahead", () => {
    expect(reminderTimeHasPassed("7:00 PM", "18:00")).toBe(false); // dinner, now 6 PM
    expect(reminderTimeHasPassed("19:30", "18:00")).toBe(false);
  });
  it("normalizes 12h/24h formats consistently", () => {
    expect(reminderTimeHasPassed("8 PM", "18:00")).toBe(false);
    expect(reminderTimeHasPassed("8:00am", "18:00")).toBe(true);
  });
  it("FAIL-SAFE: an unparseable time does NOT skip (better a late reminder than a dropped one)", () => {
    expect(reminderTimeHasPassed("whenever", "18:00")).toBe(false);
    expect(reminderTimeHasPassed("", "18:00")).toBe(false);
  });
});
