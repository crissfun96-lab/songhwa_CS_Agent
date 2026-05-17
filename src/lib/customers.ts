import { getDb } from "./firebase-admin";
import type { CustomerProfile } from "./types";

const COLLECTION = "songhwa_customers";

// Fix Bug #8: was full collection scan on every voice tool call.
// Now uses indexed `where("nameLower", "==", needle)` for the common case.
// Falls back to a scan ONLY when no exact match exists (rare — for partial match).
export async function lookupCustomerByName(name: string): Promise<CustomerProfile | null> {
  const needle = name.toLowerCase().trim();
  if (!needle) return null;

  // Indexed exact match — O(1)
  const exactSnap = await getDb()
    .collection(COLLECTION)
    .where("nameLower", "==", needle)
    .limit(1)
    .get();
  if (!exactSnap.empty) {
    return exactSnap.docs[0].data() as CustomerProfile;
  }

  // Partial match fallback — O(N) but capped to avoid running across millions
  const PARTIAL_SCAN_LIMIT = 500;
  const fallbackSnap = await getDb()
    .collection(COLLECTION)
    .limit(PARTIAL_SCAN_LIMIT)
    .get();
  const customers = fallbackSnap.docs.map((doc) => doc.data() as CustomerProfile);
  const partial = customers.find(
    (c) => c.nameLower.includes(needle) || needle.includes(c.nameLower),
  );
  return partial ?? null;
}

export async function upsertCustomer(
  name: string,
  phone: string,
  menuChoice: string,
  remarks: string,
  date: string,
  time: string,
  pax: number,
): Promise<void> {
  const nameLower = name.toLowerCase().trim();
  const visit = { date, time, pax, menuChoice, remarks };

  const snapshot = await getDb()
    .collection(COLLECTION)
    .where("nameLower", "==", nameLower)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    const doc = snapshot.docs[0];
    const existing = doc.data() as CustomerProfile;

    const updatedFavorites = menuChoice
      ? [...new Set([...existing.favoriteOrders, menuChoice])]
      : existing.favoriteOrders;

    await doc.ref.update({
      phone: phone || existing.phone,
      visitCount: existing.visitCount + 1,
      lastVisit: new Date().toISOString(),
      favoriteOrders: updatedFavorites,
      reservations: [...existing.reservations, visit],
    });
  } else {
    const profile: CustomerProfile = {
      name,
      nameLower,
      phone,
      visitCount: 1,
      lastVisit: new Date().toISOString(),
      favoriteOrders: menuChoice ? [menuChoice] : [],
      reservations: [visit],
    };
    await getDb().collection(COLLECTION).add(profile);
  }
}
