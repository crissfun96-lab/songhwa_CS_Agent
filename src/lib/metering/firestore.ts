import { getDb } from "../firebase-admin";
import { DEFAULT_TENANT_ID } from "../tenants/types";
import type {
  MeteringEvent,
  MeteringEventType,
  MeteringRollup,
} from "./types";

const EVENTS_COLLECTION = "foxie_metering_events";
const ROLLUPS_COLLECTION = "foxie_metering_rollups";

function ymdKL(date: Date = new Date()): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return f.format(date); // en-CA → YYYY-MM-DD
}

export async function emit(
  type: MeteringEventType,
  opts: {
    tenantId?: string;
    units?: number;
    channel?: "web" | "phone" | "wa";
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  // Fire-and-forget — never block the user flow on metering writes.
  const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tid = (opts.tenantId ?? DEFAULT_TENANT_ID).toLowerCase();
  const now = new Date();
  const ymd = ymdKL(now);
  const event: MeteringEvent = {
    id,
    tenantId: tid,
    type,
    units: opts.units ?? 1,
    ...(opts.channel && { channel: opts.channel }),
    ...(opts.metadata && { metadata: opts.metadata }),
    at: now.toISOString(),
    ymd,
    ym: ymd.slice(0, 7),
  };
  try {
    await getDb().collection(EVENTS_COLLECTION).doc(id).set(event);
  } catch (err) {
    // Don't throw — metering can never break the actual feature
    console.error("[metering] emit failed:", err);
  }
}

// Synchronous fire-and-forget helper for hot paths
export function emitAsync(
  type: MeteringEventType,
  opts: Parameters<typeof emit>[1] = {},
): void {
  emit(type, opts).catch((err) => console.error("[metering] async emit failed:", err));
}

export async function rollupDay(ymd: string): Promise<{ tenantCount: number; eventCount: number }> {
  const snap = await getDb()
    .collection(EVENTS_COLLECTION)
    .where("ymd", "==", ymd)
    .get();

  const byTenant = new Map<string, MeteringRollup>();
  for (const doc of snap.docs) {
    const ev = doc.data() as MeteringEvent;
    let r = byTenant.get(ev.tenantId);
    if (!r) {
      r = {
        id: `${ev.tenantId}_${ymd}`,
        tenantId: ev.tenantId,
        ymd,
        ym: ymd.slice(0, 7),
        totals: {},
        eventCount: 0,
        computedAt: new Date().toISOString(),
      };
      byTenant.set(ev.tenantId, r);
    }
    r.totals[ev.type] = (r.totals[ev.type] ?? 0) + ev.units;
    r.eventCount++;
  }

  for (const r of byTenant.values()) {
    await getDb().collection(ROLLUPS_COLLECTION).doc(r.id).set(r);
  }
  return { tenantCount: byTenant.size, eventCount: snap.size };
}

export async function getMonthUsage(
  tenantId: string,
  ym?: string,
): Promise<Partial<Record<MeteringEventType, number>>> {
  const ymStr = ym ?? ymdKL().slice(0, 7);
  const snap = await getDb()
    .collection(ROLLUPS_COLLECTION)
    .where("tenantId", "==", tenantId)
    .where("ym", "==", ymStr)
    .get();
  const out: Partial<Record<MeteringEventType, number>> = {};
  for (const doc of snap.docs) {
    const r = doc.data() as MeteringRollup;
    for (const [type, units] of Object.entries(r.totals)) {
      out[type as MeteringEventType] = (out[type as MeteringEventType] ?? 0) + units;
    }
  }
  return out;
}

// Real-time usage (sums events directly, not rollups — for in-month enforcement)
export async function getLiveMonthUsage(
  tenantId: string,
  type: MeteringEventType,
  ym?: string,
): Promise<number> {
  const ymStr = ym ?? ymdKL().slice(0, 7);
  const snap = await getDb()
    .collection(EVENTS_COLLECTION)
    .where("tenantId", "==", tenantId)
    .where("type", "==", type)
    .where("ym", "==", ymStr)
    .get();
  let total = 0;
  for (const doc of snap.docs) {
    total += (doc.data() as MeteringEvent).units;
  }
  return total;
}
