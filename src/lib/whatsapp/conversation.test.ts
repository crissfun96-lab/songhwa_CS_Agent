import { describe, it, expect } from "vitest";
import { sanitizeHistoryForModel, type ConvMessage } from "./conversation";

// Bug this guards (P1): conversation history is trimmed with a blind `.slice(-MAX_TURNS)`,
// which can cut THROUGH a functionCall/functionResponse pair — leaving the window starting
// on an orphan functionResponse. Gemini rejects a functionResponse with no preceding
// functionCall (HTTP 400), the dispatcher's call throws, and the customer is left on silent
// read mid-booking. sanitizeHistoryForModel drops leading orphans so the window always
// starts on a valid turn (a user message, or model text) — never a dangling tool turn.

const user = (text: string): ConvMessage => ({ role: "user", text, at: "t" });
const modelText = (text: string): ConvMessage => ({ role: "model", text, at: "t" });
const modelCall = (name: string): ConvMessage => ({
  role: "model",
  functionCall: { name, args: {} },
  at: "t",
});
const fnResp = (name: string): ConvMessage => ({
  role: "function",
  functionResponse: { name, response: { ok: true } },
  at: "t",
});

describe("sanitizeHistoryForModel", () => {
  it("returns empty for empty input", () => {
    expect(sanitizeHistoryForModel([])).toEqual([]);
  });

  it("leaves a window that already starts on a user turn untouched", () => {
    const h = [user("hi"), modelText("hello!"), user("book 4 sat 7pm")];
    expect(sanitizeHistoryForModel(h)).toEqual(h);
  });

  it("drops a leading orphan functionResponse (the exact 400 trigger)", () => {
    const h = [fnResp("check_availability"), user("yes book it"), modelText("done")];
    expect(sanitizeHistoryForModel(h)).toEqual([user("yes book it"), modelText("done")]);
  });

  it("drops a leading orphan functionCall+functionResponse pair", () => {
    const h = [modelCall("create_reservation"), fnResp("create_reservation"), user("thanks")];
    expect(sanitizeHistoryForModel(h)).toEqual([user("thanks")]);
  });

  it("keeps a leading model TEXT turn (valid context, not a dangling tool turn)", () => {
    const h = [modelText("welcome back!"), user("change my booking")];
    expect(sanitizeHistoryForModel(h)).toEqual(h);
  });

  it("returns empty when the whole window is dangling tool turns", () => {
    expect(sanitizeHistoryForModel([fnResp("a"), modelCall("b"), fnResp("b")])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const h = [fnResp("x"), user("hi")];
    const copy = [...h];
    sanitizeHistoryForModel(h);
    expect(h).toEqual(copy);
  });

  it("only trims the LEADING boundary — keeps intact pairs later in the window", () => {
    const h = [
      fnResp("orphan"), // gets dropped
      user("book a table"),
      modelCall("check_availability"),
      fnResp("check_availability"),
      modelText("You're booked!"),
    ];
    expect(sanitizeHistoryForModel(h)).toEqual([
      user("book a table"),
      modelCall("check_availability"),
      fnResp("check_availability"),
      modelText("You're booked!"),
    ]);
  });
});
