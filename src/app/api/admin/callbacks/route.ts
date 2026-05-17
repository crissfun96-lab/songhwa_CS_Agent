import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import type { CallbackRequest } from "@/lib/callbacks/types";

export async function GET() {
  try {
    const snapshot = await getDb()
      .collection("songhwa_callbacks")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    const callbacks = snapshot.docs.map((d) => d.data() as CallbackRequest);
    return NextResponse.json({ success: true, data: callbacks });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
