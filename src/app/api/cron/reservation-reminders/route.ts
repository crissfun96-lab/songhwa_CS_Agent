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
import { reminderSweepDates, reminderTimeHasPassed } from "@/lib/reservations/reminder-schedule";
import { getKlNow } from "@/lib/menu/firestore";
import { sendBookingReminder, isMetaWaConfigured } from "@/lib/whatsapp/meta-client";
import { sendToStaffRaw } from "@/lib/telegram";
import { verifyBearer } from "@/lib/auth-secret";
import { log } from "@/lib/logger";
import type { Reservation } from "@/lib/types";

interface TenantReminderResult {
  tenantId: string;
  sent: number;
  failed: number;
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
    const sweepDates = reminderSweepDates();
    const todayDate = sweepDates[1];
    const nowHhmm = getKlNow().hhmm;
    const tenants = await listActiveTenants();
    let sent = 0;
    const perTenant: TenantReminderResult[] = [];
    // Last-chance (today-pass) failures, collected across ALL tenants → ONE staff alert at the
    // end, so a full Meta outage doesn't fan out hundreds of individual Telegram messages.
    const undelivered: string[] = [];

    for (const tenant of tenants) {
      const tenantResult: TenantReminderResult = { tenantId: tenant.id, sent: 0, failed: 0 };

      try {
        // Sweep tomorrow (day-before) then today (same-day retry for a missed reminder).
        for (const dateKey of sweepDates) {
          const isLastChance = dateKey === todayDate; // no retry window after today
          const snap = await getDb()
            .collection(tc(tenant.id, "reservations"))
            .where("date", "==", dateKey)
            .where("status", "==", "confirmed")
            .get();

          for (const doc of snap.docs) {
            const reservation = doc.data() as Reservation;

            // Idempotency: skip anything we've already reminded.
            if (reservation.reminderSentAt) continue;

            // On the same-day retry pass, don't remind about a slot whose time already passed
            // (e.g. a 6 PM cron run reminding about a 12 PM lunch). The tomorrow pass is always future.
            if (isLastChance && reminderTimeHasPassed(reservation.time, nowHhmm)) continue;

            // Per-reservation try/catch so one failure never aborts the batch.
            try {
              await sendBookingReminder(reservation);
              await doc.ref.update({ reminderSentAt: new Date().toISOString() });
              tenantResult.sent += 1;
              sent += 1;
            } catch (err) {
              tenantResult.failed += 1;
              await doc.ref.update({ reminderFailedAt: new Date().toISOString() }).catch(() => {});
              log.error({
                event: "reservation_reminder_send_failed",
                tenantId: tenant.id,
                reservationId: reservation.id,
                lastChance: isLastChance,
                err,
              });
              // After today there is no further retry window — collect for a single staff alert.
              if (isLastChance) {
                undelivered.push(
                  `• ${reservation.name} (${reservation.phone}) — ${reservation.date} ${reservation.time}, ${reservation.pax} pax`,
                );
              }
            }
          }
        }
      } catch (err) {
        // A whole-tenant query failure shouldn't sink the other tenants.
        log.error({ event: "reservation_reminder_tenant_sweep_failed", tenantId: tenant.id, err });
      }

      perTenant.push(tenantResult);
    }

    // ONE aggregated staff alert for all of today's undelivered reminders (no per-reservation spam).
    if (undelivered.length > 0) {
      sendToStaffRaw(
        `⚠️ ${undelivered.length} reminder(s) could not be delivered today — please remind these guests manually:\n` +
          undelivered.slice(0, 30).join("\n") +
          (undelivered.length > 30 ? `\n…and ${undelivered.length - 30} more.` : ""),
      ).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      dates: sweepDates,
      sent,
      undelivered: undelivered.length,
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
