// Intent capture — saves partial reservation data every time agent has it.
// If the call drops mid-booking, manager still sees the draft and can follow up.
// This is our safety net against "missed" reservations.

import { getDb } from "../firebase-admin";
import { tc } from "../tenants/collection";
import { DEFAULT_TENANT_ID } from "../tenants/types";

export interface ReservationDraft {
  id: string;
  sessionId: string;           // from the voice agent session
  name: string | null;
  phone: string | null;
  date: string | null;
  time: string | null;
  pax: number | null;
  menuChoice: string | null;
  remarks: string | null;
  completeness: number;        // 0-5, how many required fields filled
  converted: boolean;          // true once full reservation saved
  convertedReservationId?: string;
  createdAt: string;
  updatedAt: string;
}

export async function upsertDraft(
  sessionId: string,
  partial: Partial<Omit<ReservationDraft, "id" | "sessionId" | "createdAt" | "updatedAt" | "completeness" | "converted">>,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<ReservationDraft> {
  const now = new Date().toISOString();
  const db = getDb();
  const collection = tc(tenantId, "reservation_drafts");

  const existing = await db
    .collection(collection)
    .where("sessionId", "==", sessionId)
    .limit(1)
    .get();

  // Only include fields explicitly provided — null/missing means "don't change"
  const providedFields: Partial<ReservationDraft> = {};
  if (partial.name !== undefined && partial.name !== null && partial.name !== "")
    providedFields.name = partial.name;
  if (partial.phone !== undefined && partial.phone !== null && partial.phone !== "")
    providedFields.phone = partial.phone;
  if (partial.date !== undefined && partial.date !== null && partial.date !== "")
    providedFields.date = partial.date;
  if (partial.time !== undefined && partial.time !== null && partial.time !== "")
    providedFields.time = partial.time;
  if (partial.pax !== undefined && partial.pax !== null)
    providedFields.pax = partial.pax;
  if (partial.menuChoice !== undefined && partial.menuChoice !== null)
    providedFields.menuChoice = partial.menuChoice;
  if (partial.remarks !== undefined && partial.remarks !== null)
    providedFields.remarks = partial.remarks;

  if (!existing.empty) {
    const doc = existing.docs[0];
    const current = doc.data() as ReservationDraft;
    const merged: ReservationDraft = {
      ...current,
      ...providedFields, // only overwrites explicitly-provided fields
      updatedAt: now,
    };
    const completeness = [merged.name, merged.phone, merged.date, merged.time, merged.pax]
      .filter((v) => v !== null && v !== "")
      .length;
    merged.completeness = Math.max(current.completeness, completeness);
    await doc.ref.set(merged);
    return merged;
  }

  const completeness = [
    providedFields.name, providedFields.phone, providedFields.date,
    providedFields.time, providedFields.pax,
  ].filter((v) => v !== null && v !== undefined && v !== "").length;

  const fields = {
    name: providedFields.name ?? null,
    phone: providedFields.phone ?? null,
    date: providedFields.date ?? null,
    time: providedFields.time ?? null,
    pax: providedFields.pax ?? null,
    menuChoice: providedFields.menuChoice ?? null,
    remarks: providedFields.remarks ?? null,
  };

  const draft: ReservationDraft = {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    ...fields,
    completeness,
    converted: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection(collection).doc(draft.id).set(draft);
  return draft;
}

export async function markDraftConverted(
  sessionId: string,
  reservationId: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<void> {
  const existing = await getDb()
    .collection(tc(tenantId, "reservation_drafts"))
    .where("sessionId", "==", sessionId)
    .limit(1)
    .get();

  if (!existing.empty) {
    await existing.docs[0].ref.update({
      converted: true,
      convertedReservationId: reservationId,
      updatedAt: new Date().toISOString(),
    });
  }
}

// For staff console: get all drafts from today that never converted
export async function getUnconvertedDrafts(
  hoursBack: number = 24,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<ReservationDraft[]> {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  const snapshot = await getDb()
    .collection(tc(tenantId, "reservation_drafts"))
    .where("converted", "==", false)
    .where("updatedAt", ">=", cutoff)
    .orderBy("updatedAt", "desc")
    .limit(50)
    .get();

  return snapshot.docs.map((d) => d.data() as ReservationDraft);
}
