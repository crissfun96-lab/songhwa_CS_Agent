// Daily metering rollup cron.
// Compresses raw events into per-tenant per-day rollups (small + fast for billing).

import { NextResponse } from "next/server";
import { rollupDay } from "@/lib/metering/firestore";
import { verifyBearer } from "@/lib/auth-secret";

function ymdKL(date: Date = new Date()): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return f.format(date);
}

export async function GET(request: Request) {
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const ymd = url.searchParams.get("ymd") ?? ymdKL(new Date(Date.now() - 24 * 60 * 60 * 1000));

  try {
    const result = await rollupDay(ymd);
    return NextResponse.json({ success: true, ymd, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg.slice(0, 200) }, { status: 500 });
  }
}
