import { NextResponse } from "next/server";
import { checkAvailability } from "@/lib/reservations/availability";
import { resolveTenantId } from "@/lib/tenants/resolver";

// GET /api/availability?date=2026-04-25&time=7:00PM&pax=4
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const time = searchParams.get("time");
  const paxStr = searchParams.get("pax");

  if (!date || !time || !paxStr) {
    return NextResponse.json(
      { success: false, error: "Missing date, time, or pax parameter" },
      { status: 400 },
    );
  }

  const pax = parseInt(paxStr, 10);
  if (!Number.isFinite(pax) || pax < 1 || pax > 50) {
    return NextResponse.json(
      { success: false, error: "Invalid pax (must be 1-50)" },
      { status: 400 },
    );
  }

  try {
    const result = await checkAvailability(date, time, pax, undefined, resolveTenantId(request));
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[availability] failed:", message);
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
