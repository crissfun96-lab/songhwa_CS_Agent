// Admin: list handoff escalations. Auth-protected via middleware.
// Default view = pending + transferring (still needing staff action).

import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import type { HandoffRequest } from "@/lib/handoff/types";

const COLLECTION = "songhwa_handoffs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "open"; // open|resolved|all
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

    let q = getDb().collection(COLLECTION).orderBy("startedAt", "desc").limit(limit);

    const snap = await q.get();
    let items = snap.docs.map((d) => d.data() as HandoffRequest);
    if (status === "open") {
      items = items.filter((h) => h.status === "pending" || h.status === "transferring" || h.status === "human_mode");
    } else if (status === "resolved") {
      items = items.filter((h) => h.status === "resolved");
    }

    return NextResponse.json({ success: true, data: items, count: items.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[admin/handoffs] error:", msg);
    return NextResponse.json({ success: false, error: msg.slice(0, 200) }, { status: 500 });
  }
}
