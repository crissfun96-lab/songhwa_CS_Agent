import { describe, it, expect } from "vitest";
import { resolveDate, klToday, isValidIsoDate } from "./date-resolver";

// Fixed anchor: noon KL on a KNOWN Saturday → deterministic, no clock reads.
//   2026-04-25T04:00:00Z == 2026-04-25 12:00 in Asia/Kuala_Lumpur (UTC+8), a Saturday.
const SAT_NOON_KL = new Date("2026-04-25T04:00:00Z");
const SATURDAY = "2026-04-25";

// Convenience: assert a successful resolve to an exact date.
function expectDate(input: string, expected: string, now: Date = SAT_NOON_KL): void {
  const r = resolveDate(input, now);
  expect(r).toEqual({ ok: true, date: expected });
}

describe("klToday", () => {
  it("returns the KL calendar date for the anchor instant", () => {
    expect(klToday(SAT_NOON_KL)).toBe(SATURDAY);
  });
});

describe("isValidIsoDate", () => {
  it("accepts a real date", () => {
    expect(isValidIsoDate("2026-04-25")).toBe(true);
  });
  it("rejects an impossible calendar date", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-00-10")).toBe(false);
  });
  it("rejects malformed strings", () => {
    expect(isValidIsoDate("2026-4-5")).toBe(false);
    expect(isValidIsoDate("April 25")).toBe(false);
  });
});

describe("resolveDate — ISO passthrough", () => {
  it("passes through a valid YYYY-MM-DD unchanged", () => {
    expectDate("2026-05-10", "2026-05-10");
  });

  it("rejects an invalid ISO date (Feb 30)", () => {
    expect(resolveDate("2026-02-30", SAT_NOON_KL)).toEqual({
      ok: false,
      reason: "invalid_date",
    });
  });
});

describe("resolveDate — English relative", () => {
  it("today / tonight → the anchor date", () => {
    expectDate("today", SATURDAY);
    expectDate("tonight", SATURDAY);
    expectDate("Tonight", SATURDAY);
  });

  it("tomorrow → +1 day", () => {
    expectDate("tomorrow", "2026-04-26");
  });

  it("day after tomorrow / overmorrow → +2 days", () => {
    expectDate("day after tomorrow", "2026-04-27");
    expectDate("the day after tomorrow", "2026-04-27");
    expectDate("overmorrow", "2026-04-27");
  });
});

describe("resolveDate — weekdays (future-rolling)", () => {
  it("bare weekday that IS today → today (upcoming)", () => {
    // Anchor is Saturday → "Saturday" resolves to today.
    expectDate("Saturday", SATURDAY);
    expectDate("sat", SATURDAY);
  });

  it("'this Saturday' → today (upcoming this week)", () => {
    expectDate("this Saturday", SATURDAY);
  });

  it("'next Saturday' → the FOLLOWING week", () => {
    expectDate("next Saturday", "2026-05-02");
  });

  it("a bare future weekday rolls forward, never backward", () => {
    // Anchor Saturday → next Monday is 2026-04-27.
    expectDate("Monday", "2026-04-27");
    expectDate("monday", "2026-04-27");
    // Sunday is tomorrow.
    expectDate("Sunday", "2026-04-26");
    // Friday already passed this week → rolls to next Friday.
    expectDate("Friday", "2026-05-01");
  });

  it("'coming Wednesday' rolls to the upcoming Wednesday", () => {
    expectDate("coming Wednesday", "2026-04-29");
  });
});

describe("resolveDate — month-name forms", () => {
  it("'25 April' (day-first, no year) → next future occurrence (this year)", () => {
    expectDate("25 April", "2026-04-25");
  });

  it("'April 25' (month-first, no year) → next future occurrence", () => {
    expectDate("April 25", "2026-04-25");
  });

  it("a month/day already PAST this year rolls to next year", () => {
    // Anchor 25 Apr 2026 → "1 January" already passed → Jan 1 2027.
    expectDate("1 January", "2027-01-01");
    expectDate("Jan 1", "2027-01-01");
  });

  it("'Apr 25 2026' with explicit year", () => {
    expectDate("Apr 25 2026", "2026-04-25");
    expectDate("25 April 2026", "2026-04-25");
  });

  it("ordinal suffixes are tolerated ('April 25th')", () => {
    expectDate("April 25th", "2026-04-25");
  });
});

describe("resolveDate — numeric Malaysian day-first", () => {
  it("'25/04' (DD/MM, no year) → next future occurrence", () => {
    expectDate("25/04", "2026-04-25");
  });

  it("'26-04' (DD-MM, no year) → tomorrow's date", () => {
    expectDate("26-04", "2026-04-26");
  });

  it("'25/04/2026' (DD/MM/YYYY)", () => {
    expectDate("25/04/2026", "2026-04-25");
  });

  it("'25/04/26' (2-digit year) → 2026", () => {
    expectDate("25/04/26", "2026-04-25");
  });

  it("day-first, NOT month-first: '04/12' is 4 December not 12 April", () => {
    expectDate("04/12", "2026-12-04");
  });

  it("rejects an out-of-range numeric date", () => {
    expect(resolveDate("45/13", SAT_NOON_KL)).toEqual({
      ok: false,
      reason: "invalid_date",
    });
  });
});

describe("resolveDate — multilingual relatives (best-effort)", () => {
  it("中文: 今天 / 明天 / 后天", () => {
    expectDate("今天", SATURDAY);
    expectDate("明天", "2026-04-26");
    expectDate("后天", "2026-04-27");
  });

  it("BM: hari ini / esok / lusa", () => {
    expectDate("hari ini", SATURDAY);
    expectDate("esok", "2026-04-26");
    expectDate("lusa", "2026-04-27");
  });

  it("KO: 오늘 / 내일 / 모레", () => {
    expectDate("오늘", SATURDAY);
    expectDate("내일", "2026-04-26");
    expectDate("모레", "2026-04-27");
  });

  it("ZH weekday: 星期六 = this Saturday (today), 下星期六 = next week", () => {
    expectDate("星期六", SATURDAY);
    expectDate("下星期六", "2026-05-02");
  });

  it("BM weekday: Sabtu = this Saturday (today)", () => {
    expectDate("Sabtu", SATURDAY);
  });
});

describe("resolveDate — KL timezone boundary", () => {
  it("a UTC instant that is a DIFFERENT calendar day in KL anchors to the KL day", () => {
    // 2026-04-25T20:00:00Z == 2026-04-26 04:00 in KL (Sunday).
    const utcLateSat = new Date("2026-04-25T20:00:00Z");
    expect(klToday(utcLateSat)).toBe("2026-04-26");
    // "today" must follow KL, not UTC.
    expect(resolveDate("today", utcLateSat)).toEqual({ ok: true, date: "2026-04-26" });
    // "tomorrow" is the KL next day.
    expect(resolveDate("tomorrow", utcLateSat)).toEqual({ ok: true, date: "2026-04-27" });
  });
});

describe("resolveDate — unparseable", () => {
  it("garbage → invalid_date", () => {
    expect(resolveDate("sometime next month maybe", SAT_NOON_KL)).toEqual({
      ok: false,
      reason: "invalid_date",
    });
    expect(resolveDate("", SAT_NOON_KL)).toEqual({ ok: false, reason: "invalid_date" });
    expect(resolveDate("   ", SAT_NOON_KL)).toEqual({ ok: false, reason: "invalid_date" });
  });
});
