// Cron-triggered day-before reservation reminders.
//
// Once a day this sweeps every active tenant, finds tomorrow's CONFIRMED
// reservations (in Asia/Kuala_Lumpur time) that haven't been reminded yet, and
// sends each customer a WhatsApp reminder via the approved `booking_reminder`
// template (falls back to free-form text inside the 24h window). After a
// successful send it stamps `reminderSentAt` so a re-run never double-sends.
//
// Auth + POST→GET delegation mirror /api/cron/wa-dispatch.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { listActiveTenants } from "@/lib/tenants/firestore";
import { tc } from "@/lib/tenants/collection";
import { getKlNow } from "@/lib/menu/firestore";
import { sendBookingReminder, isMetaWaConfigured } from "@/lib/whatsapp/meta-client";
import { verifyBearer } from "@/lib/auth-secret";
import { log } from "@/lib/logger";
import type { Reservation } from "@/lib/types";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface TenantReminderResult {
  tenantId: string;
  sent: number;
  failed: number;
}

// Tomorrow's date as YYYY-MM-DD in Asia/Kuala_Lumpur. We advance the absolute
// instant by 24h, then read the KL calendar date of that instant — correct
// across midnight boundaries and independent of the server's local timezone.
function tomorrowKlDate(now: Date = new Date()): string {
  return getKlNow(new Date(now.getTime() + ONE_DAY_MS)).date;
}

export async function GET(request: Request) {
  // Generic 401 regardless of config state (no info leak)
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Env-guard: if Meta WA isn't configured, there's nothing to deliver.
  if (!isMetaWaConfigured()) {
    return NextResponse.json({ success: true, skipped: true });
  }

  try {
    const tomorrow = tomorrowKlDate();
    const tenants = await listActiveTenants();
    let sent = 0;
    const perTenant: TenantReminderResult[] = [];

    for (const tenant of tenants) {
      const tenantResult: TenantReminderResult = { tenantId: tenant.id, sent: 0, failed: 0 };

      try {
        const snap = await getDb()
          .collection(tc(tenant.id, "reservations"))
          .where("date", "==", tomorrow)
          .where("status", "==", "confirmed")
          .get();

        for (const doc of snap.docs) {
          const reservation = doc.data() as Reservation;

          // Idempotency: skip anything we've already reminded.
          if (reservation.reminderSentAt) continue;

          // Per-reservation try/catch so one failure never aborts the batch.
          try {
            await sendBookingReminder(reservation);
            await doc.ref.update({ reminderSentAt: new Date().toISOString() });
            tenantResult.sent += 1;
            sent += 1;
          } catch (err) {
            tenantResult.failed += 1;
            log.error({
              event: "reservation_reminder_send_failed",
              tenantId: tenant.id,
              reservationId: reservation.id,
              err,
            });
          }
        }
      } catch (err) {
        // A whole-tenant query failure shouldn't sink the other tenants.
        log.error({ event: "reservation_reminder_tenant_sweep_failed", tenantId: tenant.id, err });
      }

      perTenant.push(tenantResult);
    }

    return NextResponse.json({
      success: true,
      date: tomorrow,
      sent,
      tenants: perTenant.length,
      perTenant,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ event: "reservation_reminder_cron_error", err: error });
    return NextResponse.json(
      { success: false, error: message.slice(0, 300) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  // Same logic as GET — POST allowed so the cron trigger can use either verb.
  return GET(request);
}
