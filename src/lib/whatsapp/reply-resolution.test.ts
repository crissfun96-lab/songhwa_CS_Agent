import { describe, it, expect } from "vitest";
import {
  resolveFinalReply,
  mutationSucceeded,
  isMutatingTool,
  GENERIC_FAILURE,
  type ToolOutcome,
} from "./reply-resolution";

// The dispatcher's tool loop is bounded. When a booking-mutating tool is the LAST
// call before the loop exits, the model never gets a turn to produce confirmation text
// (finalText stays null). The old code then told the customer the booking FAILED even
// though it succeeded in Firestore. resolveFinalReply is the guarantee that this never
// happens: a just-succeeded mutation always yields a confirmation, never the failure line.

describe("mutationSucceeded", () => {
  it("is true for create_reservation success shape (saved:true)", () => {
    expect(mutationSucceeded({ saved: true, message: "ok" })).toBe(true);
  });
  it("is true for update/cancel route success shape (success:true)", () => {
    expect(mutationSucceeded({ success: true })).toBe(true);
  });
  it("is false for failure shapes and junk", () => {
    expect(mutationSucceeded({ saved: false })).toBe(false);
    expect(mutationSucceeded({ success: false })).toBe(false);
    expect(mutationSucceeded({ error: "boom" })).toBe(false);
    expect(mutationSucceeded({})).toBe(false);
    expect(mutationSucceeded(undefined)).toBe(false);
  });
});

describe("isMutatingTool", () => {
  it("recognizes the three booking-mutating tools", () => {
    expect(isMutatingTool("create_reservation")).toBe(true);
    expect(isMutatingTool("update_reservation")).toBe(true);
    expect(isMutatingTool("cancel_reservation")).toBe(true);
  });
  it("rejects read-only / non-mutating tools", () => {
    expect(isMutatingTool("check_availability")).toBe(false);
    expect(isMutatingTool("lookup_customer")).toBe(false);
    expect(isMutatingTool("search_menu")).toBe(false);
  });
});

describe("resolveFinalReply", () => {
  it("uses the model's text when present (the normal path)", () => {
    expect(resolveFinalReply("Your table for 4 is booked! 🎉", null)).toBe(
      "Your table for 4 is booked! 🎉",
    );
  });

  it("treats empty/whitespace finalText as absent", () => {
    expect(resolveFinalReply("   ", null)).toBe(GENERIC_FAILURE);
    expect(resolveFinalReply("", null)).toBe(GENERIC_FAILURE);
    expect(resolveFinalReply(null, null)).toBe(GENERIC_FAILURE);
  });

  it("THE P1 FIX: no model text but create_reservation just succeeded → send its confirmation, NOT failure", () => {
    const lastMutation: ToolOutcome = {
      name: "create_reservation",
      result: { saved: true, message: "Booking confirmed for John, 4 pax on 2026-06-07 at 19:00. Staff notified." },
    };
    const reply = resolveFinalReply(null, lastMutation);
    expect(reply).toBe("Booking confirmed for John, 4 pax on 2026-06-07 at 19:00. Staff notified.");
    expect(reply).not.toBe(GENERIC_FAILURE);
  });

  it("create succeeded but somehow no message field → a safe confirmation, never failure", () => {
    const reply = resolveFinalReply(null, { name: "create_reservation", result: { saved: true } });
    expect(reply).not.toBe(GENERIC_FAILURE);
    expect(reply.toLowerCase()).toContain("confirm");
  });

  it("update_reservation success with no text → an update confirmation", () => {
    const reply = resolveFinalReply(null, { name: "update_reservation", result: { success: true } });
    expect(reply).not.toBe(GENERIC_FAILURE);
    expect(reply.toLowerCase()).toContain("updated");
  });

  it("cancel_reservation success with no text → a cancel confirmation", () => {
    const reply = resolveFinalReply(null, { name: "cancel_reservation", result: { success: true } });
    expect(reply).not.toBe(GENERIC_FAILURE);
    expect(reply.toLowerCase()).toContain("cancel");
  });

  it("create_reservation FAILED (saved:false) → generic failure (do not fake a confirmation)", () => {
    const reply = resolveFinalReply(null, {
      name: "create_reservation",
      result: { saved: false, code: "fully_booked" },
    });
    expect(reply).toBe(GENERIC_FAILURE);
  });

  it("last tool was non-mutating (check_availability) → generic failure (never imply a booking)", () => {
    const reply = resolveFinalReply(null, {
      name: "check_availability",
      result: { available: true },
    });
    expect(reply).toBe(GENERIC_FAILURE);
  });
});
