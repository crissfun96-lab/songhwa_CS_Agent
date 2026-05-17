import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { MENU_COLLECTIONS } from "@/lib/menu/firestore";

// Aggregated counts for the admin dashboard landing page
export async function GET() {
  try {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    const [
      menuSnap,
      setSnap,
      promoSnap,
      reservationSnap,
      complaintSnap,
      callbackSnap,
    ] = await Promise.all([
      db.collection(MENU_COLLECTIONS.menuItems).get(),
      db.collection(MENU_COLLECTIONS.menuSets).get(),
      db.collection(MENU_COLLECTIONS.promos).get(),
      db.collection("songhwa_reservations").orderBy("createdAt", "desc").limit(100).get(),
      db.collection("songhwa_complaints").orderBy("createdAt", "desc").limit(100).get(),
      db.collection("songhwa_callbacks").orderBy("createdAt", "desc").limit(100).get(),
    ]);

    const activeMenu = menuSnap.docs.filter((d) => d.data().isActive).length;
    const activePromos = promoSnap.docs.filter((d) => d.data().isActive).length;
    const todayReservations = reservationSnap.docs.filter((d) => d.data().date === today).length;
    const openComplaints = complaintSnap.docs.filter((d) => {
      const status = d.data().status;
      return status === "new" || status === "acknowledged" || status === "in_progress";
    }).length;
    const openCallbacks = callbackSnap.docs.filter((d) => {
      const status = d.data().status;
      return status === "queued" || status === "in_progress";
    }).length;

    return NextResponse.json({
      success: true,
      data: {
        menu: { total: menuSnap.size, active: activeMenu },
        sets: { total: setSnap.size },
        promos: { total: promoSnap.size, active: activePromos },
        reservations: { recent: reservationSnap.size, today: todayReservations },
        complaints: { recent: complaintSnap.size, open: openComplaints },
        callbacks: { recent: callbackSnap.size, open: openCallbacks },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
