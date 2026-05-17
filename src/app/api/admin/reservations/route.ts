import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import type { Reservation } from "@/lib/types";

// GET /api/admin/reservations — list ALL (including cancelled)
export async function GET() {
  try {
    const snapshot = await getDb()
      .collection("songhwa_reservations")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();
    const reservations = snapshot.docs.map((d) => d.data() as Reservation);
    return NextResponse.json({ success: true, data: reservations });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
