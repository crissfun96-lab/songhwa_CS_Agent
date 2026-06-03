import { describe, it, expect } from "vitest";
import { klDayOfWeek, todayHoursText } from "./firestore";
import type { BusinessInfo, DailyHours } from "./types";

// Bug this guards (P2 truthfulness): /api/business/status returned `today_hours:
// weekdayDescriptions[0]` — ALWAYS index 0 (Sunday in the fallback, Monday for live GBP
// data) regardless of the actual day. The agent quoted the wrong day's hours 6 days a week.
// The fix selects the hours entry whose dayOfWeek matches today in Kuala Lumpur time.

// Distinct periods per day so we can tell which one was selected. dayOfWeek: 0 = Sunday.
const hours: DailyHours[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
  dayOfWeek: d as 0 | 1 | 2 | 3 | 4 | 5 | 6,
  isClosed: false,
  // Encode the day index into the open minute so the formatted string is identifiable.
  periods: [{ openHhmm: `1${d}:00`, closeHhmm: `2${d}:00` }],
}));

const info = { hours, weekdayDescriptions: [] } as unknown as BusinessInfo;

describe("klDayOfWeek (Asia/Kuala_Lumpur, 0 = Sunday)", () => {
  it("returns the KL weekday number", () => {
    // 2026-06-03 is a Wednesday; midday UTC is still Wednesday in KL (UTC+8).
    expect(klDayOfWeek(new Date("2026-06-03T04:00:00Z"))).toBe(3); // Wed
    expect(klDayOfWeek(new Date("2026-06-04T04:00:00Z"))).toBe(4); // Thu
  });

  it("respects the KL timezone offset across the UTC date boundary", () => {
    // 2026-06-03T17:00:00Z = 2026-06-04 01:00 in KL → Thursday, not Wednesday.
    expect(klDayOfWeek(new Date("2026-06-03T17:00:00Z"))).toBe(4);
  });
});

describe("todayHoursText", () => {
  it("returns TODAY's hours, not always day index 0", () => {
    const wed = todayHoursText(info, new Date("2026-06-03T04:00:00Z")); // Wed → dayOfWeek 3
    expect(wed).toContain("13:00"); // open minute encodes day 3
    expect(wed).not.toContain("10:00"); // would be Sunday (day 0) — the old bug

    const thu = todayHoursText(info, new Date("2026-06-04T04:00:00Z")); // Thu → dayOfWeek 4
    expect(thu).toContain("14:00");
  });

  it("reflects a closed day correctly", () => {
    const closedWed: DailyHours[] = hours.map((h) =>
      h.dayOfWeek === 3 ? { ...h, isClosed: true, periods: [] } : h,
    );
    const out = todayHoursText({ hours: closedWed, weekdayDescriptions: [] } as unknown as BusinessInfo, new Date("2026-06-03T04:00:00Z"));
    expect(out.toLowerCase()).toContain("closed");
  });
});
