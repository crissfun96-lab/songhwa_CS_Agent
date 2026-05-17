import { NextResponse } from "next/server";
import { syncAll } from "@/lib/menu/sheet-sync";
import { buildCompactSummary } from "@/lib/menu/prompt-injector";

// Cron-triggered sync. Protected by CRON_SECRET header (Vercel Cron sets this).
// Manual trigger: POST with { "secret": "..." } in body.

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  // Accept secret from header (Vercel Cron) or body (manual)
  const authHeader = request.headers.get("authorization");
  let providedSecret = authHeader?.replace(/^Bearer\s+/i, "");
  if (!providedSecret) {
    try {
      const body = await request.json();
      providedSecret = typeof body?.secret === "string" ? body.secret : undefined;
    } catch {
      // body might not be JSON — that's fine
    }
  }

  if (providedSecret !== cronSecret) {
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
    const syncResult = await syncAll({ spreadsheetId, apiKey });
    const summary = await buildCompactSummary();

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
    console.error("[menu/sync] failed:", message);
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
