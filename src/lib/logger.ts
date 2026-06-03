// Structured logger — the app's single observability primitive.
// Emits ONE JSON line per call so Vercel / Axiom / Logflare can index by field.
//
// Usage:
//   import { log } from "@/lib/logger";
//   log.info({ event: "reservation_created", tenantId, reservationId, pax });
//   log.error({ event: "telegram_send_failed", tenantId, err });   // pass the Error directly
//
// Guarantees (see logger.test.ts):
//   • Errors serialize to {name, message, stack} — never the `{}` that JSON.stringify(Error) yields.
//   • PII (phone/email) is masked and secrets (token/secret/authorization/apiKey/…) are [REDACTED],
//     deeply — customer phone numbers and Meta/Stripe tokens must never reach retained logs (PDPA).
//   • The caller's context object is never mutated (a redacted COPY is emitted).
//   • Circular references don't throw.
//   • `debug` is suppressed in production unless LOG_LEVEL=debug.

type Level = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
  event?: string;
  tenantId?: string;
}

// Keys whose VALUE is a credential — replaced wholesale. Substring, case-insensitive.
const SECRET_KEY = /pass(word|wd)?|secret|token|api[_-]?key|apikey|authorization|cookie|signature|credential/i;
// Keys that hold PII — partially masked so logs stay useful without leaking the identifier.
const PII_KEY = /phone|mobile|email|whatsapp|wa_?id/i;

const REDACTED = "[REDACTED]";
const STACK_LINES = 5; // cap stack depth so error logs don't balloon

function maskPhone(value: string): string {
  if (value.length <= 2) return "**";
  return "*".repeat(value.length - 2) + value.slice(-2);
}

function maskEmail(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return maskPhone(value); // not an email shape — fall back to generic mask
  return `${value[0]}***${value.slice(at)}`;
}

function maskPii(key: string, value: unknown): string {
  const str = String(value);
  return /email/i.test(key) ? maskEmail(str) : maskPhone(str);
}

function serializeError(err: Error, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: err.name,
    message: err.message,
    stack: err.stack ? err.stack.split("\n").slice(0, STACK_LINES).join("\n") : undefined,
  };
  if (err.cause !== undefined) out.cause = redact(err.cause, seen);
  return out;
}

// Build a redacted, serializable COPY of `value`. Never mutates the input.
function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) return serializeError(value, seen);
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, seen));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      out[key] = REDACTED;
    } else if (PII_KEY.test(key) && (typeof val === "string" || typeof val === "number")) {
      out[key] = maskPii(key, val);
    } else {
      out[key] = redact(val, seen);
    }
  }
  return out;
}

// `debug` is noise in production; everything else always emits.
function shouldEmit(level: Level): boolean {
  if (level !== "debug") return true;
  return process.env.LOG_LEVEL?.toLowerCase() === "debug" || process.env.NODE_ENV !== "production";
}

function emit(level: Level, ctx: LogContext): void {
  if (!shouldEmit(level)) return;

  const record = {
    level,
    ts: new Date().toISOString(),
    ...(redact(ctx, new WeakSet()) as Record<string, unknown>),
  };

  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    // Last-resort guard — a non-serializable value slipped past redact(). Never throw from logging.
    line = JSON.stringify({ level, ts: record.ts, event: ctx.event, _logError: "unserializable_context" });
  }

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
      break;
  }
}

export const log = {
  debug: (ctx: LogContext) => emit("debug", ctx),
  info: (ctx: LogContext) => emit("info", ctx),
  warn: (ctx: LogContext) => emit("warn", ctx),
  error: (ctx: LogContext) => emit("error", ctx),
};
