import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { log } from "@/lib/logger";
import { getDb } from "../firebase-admin";
import { DEFAULT_TENANT_ID } from "../tenants/types";
import type {
  MeteringEvent,
  MeteringEventType,
  MeteringRollup,
} from "./types";

const EVENTS_COLLECTION = "foxie_metering_events";
const ROLLUPS_COLLECTION = "foxie_metering_rollups";
// Per-tenant per-month per-type running counter, maintained write-through
// by emit(). Enables O(1) in-month quota enforcement (see getLiveMonthUsage).
const COUNTERS_COLLECTION = "foxie_metering_counters";

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
  const tid = (opts.tenantId ?? DEFAULT_TENANT_ID).toLowerCase();
  const now = new Date();
  const ymd = ymdKL(now);
  const ym = ymd.slice(0, 7);
  const units = opts.units ?? 1;
  // Shard doc IDs by tenant prefix so high-volume writes spread across
  // multiple Firestore hot-key ranges instead of all hitting `m_*`.
  // crypto.randomUUID is collision-resistant under burst load.
  const shard = tid.slice(0, 4) || "x";
  const id = `${shard}_${crypto.randomUUID()}`;
  const event: MeteringEvent = {
    id,
    tenantId: tid,
    type,
    units,
    ...(opts.channel && { channel: opts.channel }),
    ...(opts.metadata && { metadata: opts.metadata }),
    at: now.toISOString(),
    ymd,
    ym,
  };
  try {
    await getDb().collection(EVENTS_COLLECTION).doc(id).set(event);
    // Write-through counter: O(1) reads for live quota enforcement.
    // FieldValue.increment is atomic; concurrent emits won't lose updates.
    // Best-effort — counter failure shouldn't break the event write.
    const counterId = `${tid}_${ym}_${type}`;
    await getDb()
      .collection(COUNTERS_COLLECTION)
      .doc(counterId)
      .set(
        {
          tenantId: tid,
          ym,
          type,
          units: FieldValue.increment(units),
          updatedAt: now.toISOString(),
        },
        { merge: true },
      );
  } catch (err) {
    // Metering can never break the actual feature
    log.error({ event: "metering_emit_failed", err, tenantId: tid });
  }
}

// Synchronous fire-and-forget helper for hot paths
export function emitAsync(
  type: MeteringEventType,
  opts: Parameters<typeof emit>[1] = {},
): void {
  emit(type, opts).catch((err) => log.error({ event: "metering_async_emit_failed", err }));
}

export async function rollupDay(ymd: string): Promise<{ tenantCount: number; eventCount: number }> {
  const PAGE = 500;
  const byTenant = new Map<string, MeteringRollup>();
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let totalEvents = 0;

  // Paginate to avoid OOM on Vercel function (1 GB ceiling, 30s timeout)
  // when a day has hundreds of thousands of events across all tenants.
  while (true) {
    let query: FirebaseFirestore.Query = getDb()
      .collection(EVENTS_COLLECTION)
      .where("ymd", "==", ymd)
      .orderBy("__name__")
      .limit(PAGE);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snap = await query.get();
    if (snap.empty) break;

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

    lastDoc = snap.docs[snap.docs.length - 1];
    totalEvents += snap.size;
    if (snap.size < PAGE) break;
  }

  // Batch rollup writes — Firestore caps each batch at 500 ops.
  const rollups = [...byTenant.values()];
  for (let i = 0; i < rollups.length; i += 500) {
    const batch = getDb().batch();
    for (const r of rollups.slice(i, i + 500)) {
      batch.set(getDb().collection(ROLLUPS_COLLECTION).doc(r.id), r);
    }
    await batch.commit();
  }

  return { tenantCount: byTenant.size, eventCount: totalEvents };
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

// Real-time month-to-date usage for in-month quota enforcement.
// Reads the write-through counter doc (O(1)) instead of scanning events.
// Counter is maintained by emit().
export async function getLiveMonthUsage(
  tenantId: string,
  type: MeteringEventType,
  ym?: string,
): Promise<number> {
  const ymStr = ym ?? ymdKL().slice(0, 7);
  const tid = tenantId.toLowerCase();
  const counterId = `${tid}_${ymStr}_${type}`;
  const doc = await getDb().collection(COUNTERS_COLLECTION).doc(counterId).get();
  if (!doc.exists) return 0;
  const data = doc.data() as { units?: number } | undefined;
  return data?.units ?? 0;
}
