import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { menuCollections } from "@/lib/menu/firestore";
import { resolveTenantId } from "@/lib/tenants/resolver";
import { tc } from "@/lib/tenants/collection";

// Aggregated counts for the admin dashboard landing page
export async function GET(request: Request) {
  try {
    const db = getDb();
    const tenantId = resolveTenantId(request);
    const cols = menuCollections(tenantId);
    const today = new Date().toISOString().slice(0, 10);

    const [
      menuSnap,
      setSnap,
      promoSnap,
      reservationSnap,
      complaintSnap,
      callbackSnap,
    ] = await Promise.all([
      db.collection(cols.menuItems).get(),
      db.collection(cols.menuSets).get(),
      db.collection(cols.promos).get(),
      db.collection(tc(tenantId, "reservations")).orderBy("createdAt", "desc").limit(100).get(),
      db.collection(tc(tenantId, "complaints")).orderBy("createdAt", "desc").limit(100).get(),
      db.collection(tc(tenantId, "callbacks")).orderBy("createdAt", "desc").limit(100).get(),
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
