import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDb } from "@/lib/firebase-admin";
import { upsertCustomer } from "@/lib/customers";
import { sendStaffNotification } from "@/lib/telegram";
import type { Reservation } from "@/lib/types";

const COLLECTION = "songhwa_reservations";

const CreateReservationSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  date: z.string().min(1),
  time: z.string().min(1),
  pax: z.number().int().min(1),
  menuChoice: z.string().optional().default(""),
  remarks: z.string().optional().default(""),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = CreateReservationSchema.parse(body);

    const reservation: Reservation = {
      id: `res_${Date.now()}`,
      name: parsed.name,
      phone: parsed.phone,
      date: parsed.date,
      time: parsed.time,
      pax: parsed.pax,
      menuChoice: parsed.menuChoice,
      remarks: parsed.remarks,
      createdAt: new Date().toISOString(),
    };

    await getDb().collection(COLLECTION).doc(reservation.id).set(reservation);

    // Upsert customer profile (non-blocking for the response, but we await it)
    await upsertCustomer(
      parsed.name,
      parsed.phone,
      parsed.menuChoice,
      parsed.remarks,
      parsed.date,
      parsed.time,
      parsed.pax,
    );

    // Telegram notification — fire and forget, never blocks reservation
    sendStaffNotification(reservation).catch((err) =>
      console.error("[Telegram] Notification failed:", err),
    );

    return NextResponse.json({ success: true, data: reservation });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid reservation data", details: error.issues },
        { status: 400 },
      );
    }
    console.error("[Reservations] POST error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create reservation" },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const snapshot = await getDb()
      .collection(COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const reservations = snapshot.docs.map((doc) => doc.data() as Reservation);
    return NextResponse.json({ success: true, data: reservations });
  } catch (error) {
    console.error("[Reservations] GET error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch reservations" },
      { status: 500 },
    );
  }
}
