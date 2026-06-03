import { NextResponse } from "next/server";
import { syncAll } from "@/lib/menu/sheet-sync";
import { buildCompactSummary } from "@/lib/menu/prompt-injector";
import { resolveTenantId } from "@/lib/tenants/resolver";
import { log } from "@/lib/logger";

// Cron-triggered sync. Protected by CRON_SECRET header (Vercel Cron sets this).
// Manual trigger: POST with { "secret": "..." } in body.

export async function POST(request: Request) {
  // SECURITY (Bug H3 fix): generic 401 regardless of config state.
  // Bug H2 fix: drop body-fallback for secret — header only (body secrets leak to logs).
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization");
  const providedSecret = authHeader?.replace(/^Bearer\s+/i, "");
  if (!cronSecret || providedSecret !== cronSecret) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const spreadsheetId = process.env.GOOGLE_SHEETS_SHEET_ID;
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

  // Graceful skip: if Sheet not configured, the seed script populates Firestore
  // directly. Cron calls this endpoint every 5 min — no alarm if Sheet unset.
  if (!spreadsheetId || !apiKey) {
    return NextResponse.json({
      success: true,
      data: {
        skipped: true,
        reason: "Google Sheet not configured — data seeded directly via script. Set GOOGLE_SHEETS_SHEET_ID + GOOGLE_SHEETS_API_KEY to enable live sync.",
      },
    });
  }

  try {
    // Tenant-scoped sync. On the Vercel cron (main domain) this resolves to the
    // default tenant (Songhwa); a tenant subdomain / internal-secret routes to theirs.
    // NOTE: Sheet credentials are still global env today — wiring per-tenant Sheet
    // creds (tenant.googleSheetsId / googleSheetsApiKey) is the follow-up before a
    // 2nd tenant's live sync; until then only the default tenant should trigger this.
    const tenantId = resolveTenantId(request);
    const syncResult = await syncAll({ spreadsheetId, apiKey }, tenantId);
    const summary = await buildCompactSummary(tenantId);

    return NextResponse.json({
      success: true,
      data: {
        sync: syncResult,
        summary: {
          sets: summary.sets.length,
          signatureDishes: summary.signatureDishes.length,
          activePromos: summary.activePromos.length,
          keyFaqs: summary.keyFaqs.length,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ event: "menu_sync_failed", err: error });
    return NextResponse.json(
      { success: false, error: message.slice(0, 500) },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: false,
    error: "Use POST with bearer token or secret in body",
  }, { status: 405 });
}
