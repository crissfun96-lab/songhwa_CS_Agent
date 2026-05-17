import { getDb } from "../firebase-admin";
import type {
  MenuItem,
  MenuSet,
  Promo,
  Faq,
  VoiceExample,
  CompactMenuSummary,
  SyncStatus,
} from "./types";

// ── Collection names (one source of truth) ────────────────────
export const MENU_COLLECTIONS = {
  menuItems: "songhwa_menu_items",
  menuSets: "songhwa_menu_sets",
  promos: "songhwa_promos",
  faqs: "songhwa_faqs",
  examples: "songhwa_voice_examples",
  photos: "songhwa_dish_photos",
  summary: "songhwa_menu_cache",
  syncStatus: "songhwa_sync_status",
} as const;

// ── Malaysia-timezone helper for promo filtering ──────────────
interface KlClock {
  date: string;       // YYYY-MM-DD
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hhmm: string;       // HH:MM, 24h
}

export function getKlNow(now: Date = new Date()): KlClock {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const lookup: Record<string, string> = {};
  for (const part of fmt.formatToParts(now)) {
    lookup[part.type] = part.value;
  }
  const date = `${lookup.year}-${lookup.month}-${lookup.day}`;
  const hhmm = `${lookup.hour}:${lookup.minute}`;
  const dayMap: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayOfWeek = dayMap[lookup.weekday] ?? 0;
  return { date, dayOfWeek, hhmm };
}

// ── Upsert helpers (source of truth: Google Sheet → Firestore) ─
export async function upsertMenuItem(item: MenuItem): Promise<void> {
  await getDb().collection(MENU_COLLECTIONS.menuItems).doc(item.id).set(item);
}

export async function upsertMenuSet(set: MenuSet): Promise<void> {
  await getDb().collection(MENU_COLLECTIONS.menuSets).doc(set.id).set(set);
}

export async function upsertPromo(promo: Promo): Promise<void> {
  await getDb().collection(MENU_COLLECTIONS.promos).doc(promo.id).set(promo);
}

export async function upsertFaq(faq: Faq): Promise<void> {
  await getDb().collection(MENU_COLLECTIONS.faqs).doc(faq.id).set(faq);
}

export async function upsertExample(example: VoiceExample): Promise<void> {
  await getDb()
    .collection(MENU_COLLECTIONS.examples)
    .doc(example.id)
    .set(example);
}

export async function markInactive(
  collection: string,
  id: string,
  sourceVersion: string,
): Promise<void> {
  await getDb().collection(collection).doc(id).update({
    isActive: false,
    sourceVersion,
    updatedAt: new Date().toISOString(),
  });
}

// ── Read helpers ──────────────────────────────────────────────
export async function getAllActiveMenuItems(): Promise<MenuItem[]> {
  const snapshot = await getDb()
    .collection(MENU_COLLECTIONS.menuItems)
    .where("isActive", "==", true)
    .get();
  return snapshot.docs.map((d) => d.data() as MenuItem);
}

export async function getAllActiveSets(): Promise<MenuSet[]> {
  const snapshot = await getDb()
    .collection(MENU_COLLECTIONS.menuSets)
    .where("isActive", "==", true)
    .get();
  return snapshot.docs.map((d) => d.data() as MenuSet);
}

export async function getAllActiveFaqs(): Promise<Faq[]> {
  const snapshot = await getDb()
    .collection(MENU_COLLECTIONS.faqs)
    .where("isActive", "==", true)
    .get();
  return snapshot.docs
    .map((d) => d.data() as Faq)
    .sort((a, b) => a.priority - b.priority);
}

// Filter promos by date/day/time window in Malaysia time
export async function getActivePromos(
  now: Date = new Date(),
): Promise<Promo[]> {
  const clock = getKlNow(now);
  const snapshot = await getDb()
    .collection(MENU_COLLECTIONS.promos)
    .where("isActive", "==", true)
    .get();
  const all = snapshot.docs.map((d) => d.data() as Promo);

  return all.filter((p) => {
    if (p.startDate > clock.date) return false;
    if (p.endDate < clock.date) return false;
    if (p.daysOfWeek && p.daysOfWeek.length > 0) {
      if (!p.daysOfWeek.includes(clock.dayOfWeek)) return false;
    }
    if (p.timeWindow) {
      if (clock.hhmm < p.timeWindow.startHhmm) return false;
      if (clock.hhmm > p.timeWindow.endHhmm) return false;
    }
    return true;
  });
}

// ── Search: in-memory filter, cheap for < 500 items ───────────
export async function searchMenu(query: string): Promise<MenuItem[]> {
  const needle = query.toLowerCase().trim();
  if (!needle) return [];

  const all = await getAllActiveMenuItems();
  const scored = all
    .map((item) => ({ item, score: scoreMatch(item, needle) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((r) => r.item);

  return scored;
}

function scoreMatch(item: MenuItem, needle: string): number {
  const nameHits = [
    item.names.en,
    item.names.zh ?? "",
    item.names.ko ?? "",
    item.names.bm ?? "",
  ]
    .map((s) => s.toLowerCase())
    .filter((s) => s.includes(needle)).length;

  const tagHit = item.tags.some((t) => t.toLowerCase().includes(needle))
    ? 1
    : 0;
  const categoryHit = item.category.includes(needle) ? 1 : 0;
  const descHit = item.description.en.toLowerCase().includes(needle) ? 1 : 0;

  // Name > tag > category > description
  return nameHits * 10 + tagHit * 5 + categoryHit * 3 + descHit * 1;
}

// ── Dish lookup (checks both collections) ─────────────────────
export type DishLookupResult =
  | { kind: "item"; data: MenuItem }
  | { kind: "set"; data: MenuSet }
  | { kind: "none" };

export async function getDishById(id: string): Promise<DishLookupResult> {
  const db = getDb();

  const itemDoc = await db.collection(MENU_COLLECTIONS.menuItems).doc(id).get();
  if (itemDoc.exists) {
    return { kind: "item", data: itemDoc.data() as MenuItem };
  }

  const setDoc = await db.collection(MENU_COLLECTIONS.menuSets).doc(id).get();
  if (setDoc.exists) {
    return { kind: "set", data: setDoc.data() as MenuSet };
  }

  return { kind: "none" };
}

// ── FAQ lookup by keyword (simple OR match) ───────────────────
export async function findFaqs(query: string, limit: number = 3): Promise<Faq[]> {
  const needle = query.toLowerCase().trim();
  if (!needle) return [];

  const all = await getAllActiveFaqs();
  return all
    .filter((f) => {
      const haystack = [
        f.question,
        ...f.keywords,
        f.category,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, limit);
}

// ── Compact menu summary cache (injected into system prompt) ──
const COMPACT_DOC_ID = "latest";

export async function saveCompactSummary(
  summary: CompactMenuSummary,
): Promise<void> {
  await getDb()
    .collection(MENU_COLLECTIONS.summary)
    .doc(COMPACT_DOC_ID)
    .set(summary);
}

export async function getCompactSummary(): Promise<CompactMenuSummary | null> {
  const doc = await getDb()
    .collection(MENU_COLLECTIONS.summary)
    .doc(COMPACT_DOC_ID)
    .get();
  return doc.exists ? (doc.data() as CompactMenuSummary) : null;
}

// ── Sync status (for observability) ───────────────────────────
export async function saveSyncStatus(status: SyncStatus): Promise<void> {
  await getDb()
    .collection(MENU_COLLECTIONS.syncStatus)
    .doc("latest")
    .set(status);
}

export async function getSyncStatus(): Promise<SyncStatus | null> {
  const doc = await getDb()
    .collection(MENU_COLLECTIONS.syncStatus)
    .doc("latest")
    .get();
  return doc.exists ? (doc.data() as SyncStatus) : null;
}
