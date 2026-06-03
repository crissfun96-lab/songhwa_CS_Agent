import { describe, it, expect } from "vitest";
import { isCapacityExceeded } from "./availability";
import type { Reservation } from "../types";

// ── Turn-time capacity model ──────────────────────────────────────────────
// A booking at T occupies the dining room for the WHOLE turn [T, T+turn):
//   lunch turn = 90 min, dinner turn = 120 min.
// Capacity at any instant = sum of pax of reservations whose [start, start+turn)
// covers that instant. A new booking is rejected iff PEAK concurrent pax across
// its own window would exceed the service cap (lunch 80 / dinner 100).
//
// These tests pin the contract of `isCapacityExceeded` — the pure, Firestore-free
// surface that BOTH the pre-flight check and the in-transaction re-check share.

const CAP_DINNER = 100;
const CAP_LUNCH = 80;

function res(time: string, pax: number, opts: Partial<Reservation> = {}): Reservation {
  return {
    id: opts.id ?? `r_${time.replace(/[: ]/g, "")}_${pax}`,
    name: "T",
    phone: "+60123456789",
    date: "2026-04-25",
    time,
    pax,
    menuChoice: "",
    remarks: "",
    createdAt: "2026-04-20T00:00:00Z",
    status: opts.status ?? "confirmed",
    ...opts,
  };
}

describe("isCapacityExceeded — single booking vs cap", () => {
  it("allows a party that exactly fills the dinner cap", () => {
    expect(isCapacityExceeded([], "7:00 PM", CAP_DINNER)).toBe(false);
  });

  it("rejects one pax over the dinner cap", () => {
    expect(isCapacityExceeded([], "7:00 PM", CAP_DINNER + 1)).toBe(true);
  });

  it("uses the lunch cap for lunch slots", () => {
    expect(isCapacityExceeded([], "12:30 PM", CAP_LUNCH)).toBe(false);
    expect(isCapacityExceeded([], "12:30 PM", CAP_LUNCH + 1)).toBe(true);
  });
});

describe("isCapacityExceeded — THE BUG: a booking must hold its full turn", () => {
  it("a 7pm full house blocks a 7:30 booking (old bucket model wrongly allowed it)", () => {
    // 19:00 party of 100 holds [19:00, 21:00). A new 100 at 19:30 overlaps → 200 > 100.
    const day = [res("7:00 PM", 100)];
    expect(isCapacityExceeded(day, "7:30 PM", 100)).toBe(true);
  });

  it("a 7pm full house blocks an 8:30 booking (still inside the 2h turn)", () => {
    // 19:00 holds until 21:00; 20:30 overlaps [20:30, 21:00).
    const day = [res("7:00 PM", 100)];
    expect(isCapacityExceeded(day, "8:30 PM", 1)).toBe(true);
  });

  it("partial overlap accumulates concurrent pax", () => {
    // 18:00 party of 60 holds [18:00, 20:00). New 50 at 19:00 overlaps [19:00, 20:00) → 110 > 100.
    const day = [res("6:00 PM", 60)];
    expect(isCapacityExceeded(day, "7:00 PM", 50)).toBe(true);
    // ...but 40 more fits exactly (60 + 40 = 100).
    expect(isCapacityExceeded(day, "7:00 PM", 40)).toBe(false);
  });
});

describe("isCapacityExceeded — legitimate second seatings ARE allowed", () => {
  it("allows a second full house exactly when the first turn ends", () => {
    // 17:30 holds [17:30, 19:30); a new 100 at 19:30 is adjacent (half-open) → no overlap.
    const day = [res("5:30 PM", 100)];
    expect(isCapacityExceeded(day, "7:30 PM", 100)).toBe(false);
  });

  it("lunch turn (90m) frees the table sooner than dinner", () => {
    // 12:00 lunch holds [12:00, 13:30); a new 80 at 13:30 is adjacent → no overlap.
    const day = [res("12:00 PM", 80)];
    expect(isCapacityExceeded(day, "1:30 PM", 80)).toBe(false);
    // but 13:00 still overlaps [13:00, 13:30) → 160 > 80.
    expect(isCapacityExceeded(day, "1:00 PM", 80)).toBe(true);
  });
});

describe("isCapacityExceeded — PEAK occupancy, not naive sum of overlappers", () => {
  it("does not double-count two reservations that never co-occur", () => {
    // Two back-to-back dinner seatings that do NOT overlap each other:
    //   18:00 holds [18:00, 20:00), 20:00 holds [20:00, 22:00).
    // A candidate of 30 at 19:30 holds [19:30, 21:30) — it overlaps BOTH, but at no
    // single instant are all three present:
    //   at 19:30 → res1(70) + cand(30) = 100
    //   at 20:00 → res2(70) + cand(30) = 100   (res1 already ended)
    // Naive "sum everyone who overlaps the candidate" = 70+70+30 = 170 (would wrongly reject).
    // Correct peak = 100 ≤ cap → allowed.
    const day = [res("6:00 PM", 70, { id: "a" }), res("8:00 PM", 70, { id: "b" })];
    expect(isCapacityExceeded(day, "7:30 PM", 30)).toBe(false);
    // One more pax tips the 19:30 instant to 101 → rejected.
    expect(isCapacityExceeded(day, "7:30 PM", 31)).toBe(true);
  });
});

describe("isCapacityExceeded — exclusions", () => {
  it("ignores cancelled reservations", () => {
    const day = [res("7:00 PM", 100, { status: "cancelled" })];
    expect(isCapacityExceeded(day, "7:00 PM", 100)).toBe(false);
  });

  it("excludes the reservation being updated (move in place)", () => {
    const day = [res("7:00 PM", 100, { id: "self" })];
    expect(isCapacityExceeded(day, "7:00 PM", 100, "self")).toBe(false);
  });

  it("tolerates an unparseable stored time (skips it, does not throw)", () => {
    const day = [res("garbage", 100), res("7:00 PM", 50)];
    expect(isCapacityExceeded(day, "7:00 PM", 50)).toBe(false);
  });
});

describe("isCapacityExceeded — reschedule semantics (exclude-self, used by the in-txn guard)", () => {
  it("rejects moving a booking into a slot already full of OTHER parties", () => {
    const day = [
      res("7:00 PM", 100, { id: "other" }), // the room is already full at 19:00
      res("6:00 PM", 30, { id: "resv" }),   // the booking being moved (currently at 18:00)
    ];
    // Move "resv" (30 pax) into 19:00 → excluding itself, OTHER parties already total 100 → reject.
    expect(isCapacityExceeded(day, "7:00 PM", 30, "resv")).toBe(true);
  });

  it("allows increasing pax in place when capacity (excluding self) still fits", () => {
    const day = [res("7:00 PM", 60, { id: "resv" })]; // only this booking at 19:00
    expect(isCapacityExceeded(day, "7:00 PM", 100, "resv")).toBe(false); // 60→100 fits exactly
    expect(isCapacityExceeded(day, "7:00 PM", 101, "resv")).toBe(true);  // 60→101 overflows
  });

  it("counts OTHER overlapping turns when a reschedule raises pax", () => {
    const day = [
      res("7:00 PM", 60, { id: "resv" }),  // being bumped to 80
      res("7:30 PM", 40, { id: "other" }), // overlaps [19:30,21:30) ∩ [19:00,21:00)
    ];
    // Excluding self: other=40 overlaps → 40 + 80 = 120 > 100 → reject the bump.
    expect(isCapacityExceeded(day, "7:00 PM", 80, "resv")).toBe(true);
    // 40 + 60 = 100 → keeping pax the same is fine.
    expect(isCapacityExceeded(day, "7:00 PM", 60, "resv")).toBe(false);
  });
});

describe("isCapacityExceeded — guards", () => {
  it("treats outside-hours as exceeded (defensive — caller validates first)", () => {
    expect(isCapacityExceeded([], "4:00 PM", 2)).toBe(true);
  });

  it("treats an invalid requested time as exceeded", () => {
    expect(isCapacityExceeded([], "not-a-time", 2)).toBe(true);
  });
});

describe("isCapacityExceeded — data-integrity hardening (adversarial findings)", () => {
  it("clamps a corrupt NEGATIVE stored pax to zero (cannot mask a full room)", () => {
    // R1 = 100 (genuine full house), R2 = -50 (corrupt write). A 7pm 2-top MUST be rejected.
    // Old `r.pax || 0` kept -50, reporting 50 booked → wrongly available (overbooking).
    const day = [res("7:00 PM", 100, { id: "a" }), res("7:00 PM", -50, { id: "b" })];
    expect(isCapacityExceeded(day, "7:00 PM", 2)).toBe(true);
  });

  it("ignores a stored reservation OUTSIDE service hours (no phantom capacity)", () => {
    // A bogus 16:00 row (neither lunch nor dinner) must not bleed into the 17:30 window.
    // 60 (real dinner) + 39 = 99 ≤ 100 → allowed; the ghost must not force fully_booked.
    const day = [res("4:00 PM", 50, { id: "ghost" }), res("5:30 PM", 60, { id: "real" })];
    expect(isCapacityExceeded(day, "5:30 PM", 39)).toBe(false);
  });

  it("treats a zero, negative, or non-finite requested pax as exceeded (defensive)", () => {
    expect(isCapacityExceeded([], "7:00 PM", 0)).toBe(true);
    expect(isCapacityExceeded([], "7:00 PM", -3)).toBe(true);
    expect(isCapacityExceeded([], "7:00 PM", NaN)).toBe(true);
    expect(isCapacityExceeded([], "7:00 PM", Infinity)).toBe(true);
  });
});
