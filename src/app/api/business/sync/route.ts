import { NextResponse } from "next/server";
import { fetchPlaceDetails, findPlaceId } from "@/lib/business/gbp-sync";
import { saveBusinessInfo } from "@/lib/business/firestore";

// POST /api/business/sync — pulls fresh GBP data, saves to Firestore.
// Vercel Cron hits this daily (business hours rarely change).
// Protected by CRON_SECRET.

export async function POST(request: Request) {
  // SECURITY (Bug H3 fix): generic 401 regardless of config state.
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization");
  const providedSecret = authHeader?.replace(/^Bearer\s+/i, "");
  if (!cronSecret || providedSecret !== cronSecret) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const placeId = process.env.SONGHWA_PLACE_ID;
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  // Graceful skip: if Places API not yet enabled, hardcoded fallback in prompt is used.
  // Chris can enable Places API + set env vars later without blocking cron.
  if (!apiKey) {
    return NextResponse.json({
      success: true,
      data: {
        skipped: true,
        reason: "Places API not configured — using fallback hours in prompt. Set GOOGLE_PLACES_API_KEY to enable live GBP sync.",
      },
    });
  }

  const startedAt = Date.now();

  try {
    // First-run helper: if no Place ID yet, look it up once
    let resolvedPlaceId = placeId;
    let resolvedMessage: string | undefined;

    if (!resolvedPlaceId) {
      const found = await findPlaceId(
        "Songhwa Korean Cuisine Millerz Square",
        apiKey,
      );
      if (!found) {
        return NextResponse.json(
          { success: false, error: "Could not auto-resolve Place ID. Set SONGHWA_PLACE_ID manually." },
          { status: 500 },
        );
      }
      resolvedPlaceId = found.placeId;
      resolvedMessage = `Resolved Place ID: ${found.placeId} (${found.name}). Add SONGHWA_PLACE_ID=${found.placeId} to Vercel env vars.`;
    }

    const info = await fetchPlaceDetails(resolvedPlaceId, apiKey);
    await saveBusinessInfo(info);

    return NextResponse.json({
      success: true,
      data: {
        info,
        durationMs: Date.now() - startedAt,
        ...(resolvedMessage && { setupMessage: resolvedMessage }),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[business/sync] failed:", message);
    return NextResponse.json(
      { success: false, error: message.slice(0, 500) },
      { status: 500 },
    );
  }
}
