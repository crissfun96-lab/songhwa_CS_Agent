import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import type { Complaint } from "@/lib/complaints/types";

export async function GET() {
  try {
    const snapshot = await getDb()
      .collection("songhwa_complaints")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    const complaints = snapshot.docs.map((d) => d.data() as Complaint);
    return NextResponse.json({ success: true, data: complaints });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
