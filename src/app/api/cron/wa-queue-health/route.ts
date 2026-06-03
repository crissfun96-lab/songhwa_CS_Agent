// Cron endpoint — alerts staff via Telegram when WA queue has dead items.
// Runs daily via vercel.json. Catches sustained Baileys outages that would
// otherwise silently lose staff notifications. Fixes Bug #10.
//
// Path is /api/cron/* (NOT /api/admin/*) to bypass the admin Basic-Auth
// middleware that intercepts Vercel cron's Bearer-token auth (was Bug C2).
//
// Triggered by Vercel cron with Authorization: Bearer $CRON_SECRET.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { log } from "@/lib/logger";
import { verifyBearer } from "@/lib/auth-secret";
import { tc } from "@/lib/tenants/collection";
import { listActiveTenants } from "@/lib/tenants/firestore";

const DEAD_THRESHOLD_ATTEMPTS = 3;
const TELEGRAM_API = (token: string) => `https://api.telegram.org/bot${token}/sendMessage`;

interface QueueItem {
  id: string;
  attempts: number;
  sentAt: string | null;
  createdAt: string;
  type: string;
  tenantId: string;
}

async function alertStaff(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_STAFF_CHAT_ID;
  if (!token || !chatId) return;

  await fetch(TELEGRAM_API(token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
  }).catch((err) => log.error({ event: "wa_queue_health_alert_failed", err }));
}

export async function GET(request: Request) {
  // Auth: Vercel cron sends Authorization: Bearer $CRON_SECRET.
  // Generic 401 regardless of env config state (no information leak).
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // Sweep every active tenant's queue, not just the default — each tenant
    // has its own `notification_queue` collection via tc().
    const tenants = await listActiveTenants();
    const deadItems: QueueItem[] = [];
    const perTenantDead: { tenantId: string; deadCount: number }[] = [];

    for (const tenant of tenants) {
      const snap = await getDb()
        .collection(tc(tenant.id, "notification_queue"))
        .where("sentAt", "==", null)
        .where("attempts", ">=", DEAD_THRESHOLD_ATTEMPTS)
        .limit(50)
        .get();

      const tenantDead = snap.docs.map((d) => ({
        ...(d.data() as QueueItem),
        tenantId: tenant.id,
      }));
      if (tenantDead.length > 0) {
        perTenantDead.push({ tenantId: tenant.id, deadCount: tenantDead.length });
        deadItems.push(...tenantDead);
      }
    }

    if (deadItems.length === 0) {
      return NextResponse.json({
        success: true,
        deadCount: 0,
        message: "WA queue healthy — no dead items",
      });
    }

    const oldest = deadItems.reduce((acc, cur) =>
      cur.createdAt < acc.createdAt ? cur : acc,
    );

    const tenantBreakdown = perTenantDead
      .map((t) => `• <code>${t.tenantId}</code>: ${t.deadCount}`)
      .join("\n");

    const message = [
      "🚨 <b>WA Notification Queue — Dead Items</b>",
      "",
      `<b>${deadItems.length}</b> messages have failed ${DEAD_THRESHOLD_ATTEMPTS}+ times across ${perTenantDead.length} tenant(s).`,
      tenantBreakdown,
      "",
      `Oldest: <code>${oldest.id}</code> (${oldest.type}) — tenant <code>${oldest.tenantId}</code>`,
      `Created: ${oldest.createdAt}`,
      "",
      "Likely causes:",
      "• Mac mini WA service down (run <code>pm2 list</code>)",
      "• Baileys session banned (delete <code>services/wa-notifier/auth/</code>, rescan QR)",
      "• Bot kicked from <i>Songhwa Reservations</i> group",
      "",
      `Run <code>pm2 logs songhwa-wa</code> to investigate.`,
    ].join("\n");

    await alertStaff(message);

    return NextResponse.json({
      success: true,
      deadCount: deadItems.length,
      oldest: oldest.id,
      perTenant: perTenantDead,
      alertSent: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ event: "wa_queue_health_error", err: error });
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
