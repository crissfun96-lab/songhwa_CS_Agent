import { getDb } from "./firebase-admin";
import { normalizePhone } from "./reservations/lifecycle";
import type { CustomerProfile } from "./types";

const COLLECTION = "songhwa_customers";

// ── Phone-based lookup (PREFERRED — Chris's request 2026-05-17) ─────
// Phone is unique per customer; name is not. Examples:
//   "Chris" vs "Christopher" vs "Mr Fun" all collide on name
//   But phone "+60 11-5430 2561" → "01154302561" is canonical
export async function lookupCustomerByPhone(phone: string): Promise<CustomerProfile | null> {
  if (!phone) return null;
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 5) return null;

  // 1. Indexed lookup on phoneNormalized (O(1) — preferred for new customers)
  const indexedSnap = await getDb()
    .collection(COLLECTION)
    .where("phoneNormalized", "==", normalized)
    .limit(1)
    .get();
  if (!indexedSnap.empty) {
    return indexedSnap.docs[0].data() as CustomerProfile;
  }

  // 2. Backfill fallback: scan customers without phoneNormalized field
  // (legacy records created before the field existed). Capped scan.
  const SCAN_LIMIT = 500;
  const scanSnap = await getDb()
    .collection(COLLECTION)
    .limit(SCAN_LIMIT)
    .get();
  const match = scanSnap.docs
    .map((d) => d.data() as CustomerProfile)
    .find((c) => normalizePhone(c.phone || "") === normalized);
  return match ?? null;
}

// ── Name-based lookup (DEPRECATED — kept for backwards compat) ──────
// Use lookupCustomerByPhone instead. This is here only so old code paths
// that still pass name keep working. Will be removed once admin UI migrates.
export async function lookupCustomerByName(name: string): Promise<CustomerProfile | null> {
  const needle = name.toLowerCase().trim();
  if (!needle) return null;

  const exactSnap = await getDb()
    .collection(COLLECTION)
    .where("nameLower", "==", needle)
    .limit(1)
    .get();
  if (!exactSnap.empty) {
    return exactSnap.docs[0].data() as CustomerProfile;
  }

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

// Upsert by PHONE (not name) — same person can have different names per session
// ("Chris" / "Christopher" / "Mr Fun") but phone is stable.
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
  const phoneNormalized = normalizePhone(phone);
  const visit = { date, time, pax, menuChoice, remarks };

  // Try indexed phone lookup first
  let existingDoc = null;
  if (phoneNormalized) {
    const phoneSnap = await getDb()
      .collection(COLLECTION)
      .where("phoneNormalized", "==", phoneNormalized)
      .limit(1)
      .get();
    if (!phoneSnap.empty) existingDoc = phoneSnap.docs[0];
  }

  // Backfill fallback: scan for customers without phoneNormalized but matching raw phone
  if (!existingDoc) {
    const scanSnap = await getDb().collection(COLLECTION).limit(500).get();
    const match = scanSnap.docs.find((d) => {
      const data = d.data() as CustomerProfile;
      return normalizePhone(data.phone || "") === phoneNormalized;
    });
    if (match) existingDoc = match;
  }

  if (existingDoc) {
    const existing = existingDoc.data() as CustomerProfile;
    const updatedFavorites = menuChoice
      ? [...new Set([...existing.favoriteOrders, menuChoice])]
      : existing.favoriteOrders;

    await existingDoc.ref.update({
      name: name || existing.name,                  // pick up new spelling
      nameLower: nameLower || existing.nameLower,
      phone: phone || existing.phone,
      phoneNormalized: phoneNormalized || existing.phoneNormalized || normalizePhone(existing.phone || ""),
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
      phoneNormalized,
      visitCount: 1,
      lastVisit: new Date().toISOString(),
      favoriteOrders: menuChoice ? [menuChoice] : [],
      reservations: [visit],
    };
    await getDb().collection(COLLECTION).add(profile);
  }
}
