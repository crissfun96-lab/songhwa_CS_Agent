// Usage metering — the missing piece for billable PaaS.
// Every billable event (voice minute, WA conversation, LLM token, tool call)
// emits a row to `foxie_metering_events`.
// Daily cron rolls into `foxie_metering_rollups` per tenant per day.

export type MeteringEventType =
  | "voice_minute"      // 1 unit = 1 minute of voice (rounded up)
  | "wa_outbound"       // 1 unit = 1 message sent via Meta WA
  | "wa_inbound"        // 1 unit = 1 customer message processed
  | "tool_call"         // 1 unit = 1 tool invocation
  | "reservation"       // 1 unit = 1 successful reservation
  | "handoff"           // 1 unit = 1 live human handoff
  | "complaint"         // 1 unit = 1 complaint filed
  | "callback"          // 1 unit = 1 callback request
  | "lead";             // 1 unit = 1 sales lead captured

export interface MeteringEvent {
  id: string;
  tenantId: string;
  type: MeteringEventType;
  units: number;                  // usually 1, but voice minutes can be 2.5 etc.
  channel?: "web" | "phone" | "wa";
  metadata?: Record<string, unknown>;
  at: string;                     // ISO timestamp
  ymd: string;                    // YYYY-MM-DD (for cheap rollup queries)
  ym: string;                     // YYYY-MM (for monthly invoice queries)
}

export interface MeteringRollup {
  id: string;                                 // `${tenantId}_${ymd}`
  tenantId: string;
  ymd: string;
  ym: string;
  totals: Partial<Record<MeteringEventType, number>>;
  eventCount: number;
  computedAt: string;
}
