// Structured logger — replaces scattered console.log calls.
// Outputs JSON lines that Vercel / Axiom / Logflare can parse + index by field.
//
// Usage:
//   import { log } from "@/lib/logger";
//   log.info({ tenantId, event: "reservation_created", reservationId, pax });
//   log.error({ tenantId, event: "telegram_send_failed", err: e.message });

type Level = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
  event?: string;
  tenantId?: string;
}

function emit(level: Level, ctx: LogContext): void {
  const record = {
    level,
    ts: new Date().toISOString(),
    ...ctx,
  };
  const line = JSON.stringify(record);
  switch (level) {
    case "error": console.error(line); break;
    case "warn":  console.warn(line); break;
    default:      console.log(line); break;
  }
}

export const log = {
  debug: (ctx: LogContext) => emit("debug", ctx),
  info:  (ctx: LogContext) => emit("info", ctx),
  warn:  (ctx: LogContext) => emit("warn", ctx),
  error: (ctx: LogContext) => emit("error", ctx),
};
