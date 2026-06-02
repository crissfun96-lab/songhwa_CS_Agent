// Cron-triggered WhatsApp message dispatcher.
// Processes the wa_inbound_messages queue (filled by /api/whatsapp/webhook).
//
// Real-time delivery comes from the webhook's fire-and-forget trigger. This
// Vercel cron is a daily safety-net sweep (Vercel Hobby allows only daily
// crons) that catches anything the webhook trigger missed. Iterates every
// active tenant so each tenant's queue is drained, not just the default.

import { NextResponse } from "next/server";
import { processInboundBatch } from "@/lib/whatsapp/dispatcher";
import { listActiveTenants } from "@/lib/tenants/firestore";
import { verifyBearer } from "@/lib/auth-secret";

interface TenantBatchResult {
  tenantId: string;
  processed: number;
  failed: number;
  skipped: number;
}

export async function GET(request: Request) {
  // Generic 401 regardless of config state (no info leak)
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const tenants = await listActiveTenants();
    const total = { processed: 0, failed: 0, skipped: 0 };
    const perTenant: TenantBatchResult[] = [];

    for (const tenant of tenants) {
      const counts = await processInboundBatch(20, tenant.id);
      total.processed += counts.processed;
      total.failed += counts.failed;
      total.skipped += counts.skipped;
      perTenant.push({ tenantId: tenant.id, ...counts });
    }

    return NextResponse.json({ success: true, total, perTenant });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[wa-dispatch] error:", message);
    return NextResponse.json(
      { success: false, error: message.slice(0, 300) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  // Same logic as GET — POST allowed for the webhook's fire-and-forget trigger.
  return GET(request);
}
