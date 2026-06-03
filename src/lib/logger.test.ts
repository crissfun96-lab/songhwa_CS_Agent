import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { log } from "./logger";

// The structured logger is the observability foundation: it emits ONE JSON line per
// call so Vercel / Axiom / Logflare can index by field. These tests pin two contracts
// that the raw `console.*` calls scattered across the app cannot give us:
//   1. Errors serialize to {name, message, stack} — NOT `{}` (the JSON.stringify-of-Error
//      trap that would silently swallow every `log.error({ err })`).
//   2. PII + secrets are redacted by default — the app logs customer phone numbers and
//      Meta/Stripe tokens; those must never land in retained logs (PDPA, Cycle 6 policy).
// Plus: deep redaction, caller-input immutability, env-aware debug, circular-ref safety.

type Spies = {
  log: ReturnType<typeof vi.spyOn>;
  warn: ReturnType<typeof vi.spyOn>;
  error: ReturnType<typeof vi.spyOn>;
};

let spies: Spies;

// Pull the single JSON line a given console method was called with and parse it.
function emitted(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  const arg = spy.mock.calls[0][0];
  expect(typeof arg).toBe("string");
  return JSON.parse(arg as string);
}

beforeEach(() => {
  spies = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("log — JSON line + level routing", () => {
  it("emits a single parseable JSON line carrying level + ts + context", () => {
    log.info({ event: "reservation_created", tenantId: "songhwa", pax: 4 });
    const rec = emitted(spies.log);
    expect(rec.level).toBe("info");
    expect(typeof rec.ts).toBe("string");
    expect(Number.isNaN(Date.parse(rec.ts as string))).toBe(false);
    expect(rec.event).toBe("reservation_created");
    expect(rec.tenantId).toBe("songhwa");
    expect(rec.pax).toBe(4);
  });

  it("routes error→console.error and warn→console.warn", () => {
    log.error({ event: "boom" });
    log.warn({ event: "careful" });
    expect(emitted(spies.error).level).toBe("error");
    expect(emitted(spies.warn).level).toBe("warn");
    expect(spies.log).not.toHaveBeenCalled();
  });
});

describe("log — Error serialization (the {} bug)", () => {
  it("serializes a top-level Error value to {name, message, stack}", () => {
    log.error({ event: "telegram_send_failed", err: new Error("network down") });
    const rec = emitted(spies.error);
    const err = rec.err as Record<string, unknown>;
    expect(err.name).toBe("Error");
    expect(err.message).toBe("network down");
    expect(typeof err.stack).toBe("string");
    // The whole point: it is NOT the empty object JSON.stringify(new Error) produces.
    expect(JSON.stringify(err)).not.toBe("{}");
  });

  it("serializes a nested Error too", () => {
    log.error({ event: "x", detail: { cause: new TypeError("bad arg") } });
    const rec = emitted(spies.error);
    const cause = (rec.detail as Record<string, unknown>).cause as Record<string, unknown>;
    expect(cause.name).toBe("TypeError");
    expect(cause.message).toBe("bad arg");
  });
});

describe("log — PII + secret redaction", () => {
  it("masks a phone number, keeping it unrecognizable", () => {
    log.info({ event: "reservation_created", phone: "60123456789" });
    const rec = emitted(spies.log);
    expect(rec.phone).not.toBe("60123456789");
    expect(String(rec.phone)).not.toContain("1234567");
  });

  it("masks an email local-part", () => {
    log.info({ event: "lead", email: "johnsmith@example.com" });
    const rec = emitted(spies.log);
    expect(rec.email).not.toBe("johnsmith@example.com");
    expect(String(rec.email)).not.toContain("johnsmith");
  });

  it("fully redacts secret-bearing keys (token / secret / authorization / apiKey)", () => {
    log.info({
      event: "wa_send",
      token: "EAAG_super_secret",
      appSecret: "shhh",
      authorization: "Bearer abc.def",
      apiKey: "sk-live-123",
    });
    const rec = emitted(spies.log);
    expect(rec.token).toBe("[REDACTED]");
    expect(rec.appSecret).toBe("[REDACTED]");
    expect(rec.authorization).toBe("[REDACTED]");
    expect(rec.apiKey).toBe("[REDACTED]");
  });

  it("redacts secrets nested deep in the context", () => {
    log.error({ event: "billing", payload: { customer: { token: "tok_live_x" } } });
    const rec = emitted(spies.error);
    const token = ((rec.payload as Record<string, unknown>).customer as Record<string, unknown>)
      .token;
    expect(token).toBe("[REDACTED]");
  });

  it("leaves non-sensitive fields untouched", () => {
    log.info({ event: "ok", tenantId: "songhwa", reservationId: "r_1", pax: 2, status: "confirmed" });
    const rec = emitted(spies.log);
    expect(rec).toMatchObject({
      tenantId: "songhwa",
      reservationId: "r_1",
      pax: 2,
      status: "confirmed",
    });
  });
});

describe("log — immutability (never mutate the caller's object)", () => {
  it("does not mutate the context the caller passed", () => {
    const ctx = { event: "x", phone: "60123456789", token: "secret", err: new Error("e") };
    log.info(ctx);
    expect(ctx.phone).toBe("60123456789"); // caller still owns the real value
    expect(ctx.token).toBe("secret");
    expect(ctx.err).toBeInstanceOf(Error);
  });
});

describe("log — robustness", () => {
  it("does not throw on circular references", () => {
    const circular: Record<string, unknown> = { event: "loop" };
    circular.self = circular;
    expect(() => log.info(circular)).not.toThrow();
    // and still emitted a parseable line
    expect(spies.log).toHaveBeenCalledTimes(1);
    expect(() => JSON.parse(spies.log.mock.calls[0][0] as string)).not.toThrow();
  });
});

describe("log — env-aware debug", () => {
  // vi.stubEnv mutates process.env without the readonly-NODE_ENV type error of a direct assign.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("suppresses debug in production (no LOG_LEVEL override)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "");
    log.debug({ event: "verbose" });
    expect(spies.log).not.toHaveBeenCalled();
  });

  it("emits debug in production when LOG_LEVEL=debug", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "debug");
    log.debug({ event: "verbose" });
    expect(spies.log).toHaveBeenCalledTimes(1);
    expect(emitted(spies.log).level).toBe("debug");
  });

  it("still emits info/warn/error in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "");
    log.info({ event: "i" });
    log.error({ event: "e" });
    expect(spies.log).toHaveBeenCalledTimes(1);
    expect(spies.error).toHaveBeenCalledTimes(1);
  });
});
