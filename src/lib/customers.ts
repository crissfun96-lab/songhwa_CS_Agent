import { db } from "./firebase-admin";
import type { CustomerProfile } from "./types";

const COLLECTION = "songhwa_customers";

export async function lookupCustomerByName(name: string): Promise<CustomerProfile | null> {
  const needle = name.toLowerCase().trim();
  const snapshot = await db.collection(COLLECTION).get();

  const customers = snapshot.docs.map((doc) => doc.data() as CustomerProfile);

  // Exact match first
  const exact = customers.find((c) => c.nameLower === needle);
  if (exact) return exact;

  // Partial match fallback
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

  const snapshot = await db
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
    await db.collection(COLLECTION).add(profile);
  }
}
