// Google Sheet → Firestore one-way sync
// The Sheet is the source of truth. Admin UI reads from Firestore only (for now).
//
// Setup:
// 1. Chris creates a public Google Sheet with tabs: menu, sets, promos, faq, examples
// 2. Sheet must be shared "Anyone with link can view"
// 3. Set env vars: GOOGLE_SHEETS_API_KEY, GOOGLE_SHEETS_SHEET_ID
// 4. POST /api/menu/sync (or via Vercel Cron every 5 min)

import { z } from "zod/v4";
import {
  upsertMenuItem,
  upsertMenuSet,
  upsertPromo,
  upsertFaq,
  upsertExample,
  markInactive,
  getAllActiveMenuItems,
  getAllActiveSets,
  saveSyncStatus,
  menuCollections,
} from "./firestore";
import { DEFAULT_TENANT_ID } from "../tenants/types";
import type {
  MenuItem,
  MenuSet,
  Promo,
  Faq,
  VoiceExample,
  SyncStatus,
  Allergen,
  DishCategory,
  SpiceLevel,
  SetFlag,
  PromoChannel,
  FaqCategory,
  Language,
} from "./types";

// ── Sheet API (public sheet + API key, no googleapis dep) ─────
export async function fetchSheetTab(
  spreadsheetId: string,
  tabName: string,
  apiKey: string,
): Promise<Record<string, string>[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}?key=${apiKey}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `Sheets API error ${res.status} for tab "${tabName}": ${errorBody.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as { values?: string[][] };
  if (!data.values || data.values.length < 2) return [];

  const [header, ...rows] = data.values;
  return rows
    .filter((row) => row.length > 0 && row[0]) // skip empty rows
    .map((row) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) {
        obj[header[i]] = row[i] ?? "";
      }
      return obj;
    });
}

// ── Zod preprocessors ─────────────────────────────────────────
const boolLike = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y";
}, z.boolean());

const numberLike = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? 0 : Number(v)),
  z.number(),
);

// Split comma/semicolon-separated strings into arrays
function splitList(value: string, sep: RegExp = /[,;]/): string[] {
  return value
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Row parsers ───────────────────────────────────────────────
const MENU_ITEM_CATEGORIES: DishCategory[] = [
  "bbq",
  "stew_soup",
  "rice_noodles",
  "appetizer_side",
  "pancake",
  "fried_chicken",
  "dessert",
  "beverage",
  "add_on",
];

const ALLERGEN_VALUES: Allergen[] = [
  "pork", "beef", "chicken", "seafood", "fish", "shellfish",
  "egg", "dairy", "gluten", "soy", "sesame", "peanut", "tree_nut", "alcohol",
];

const SET_FLAG_VALUES: SetFlag[] = [
  "best_seller", "super_value", "couples_choice", "premium", "budget", "new",
];

const PROMO_CHANNEL_VALUES: PromoChannel[] = [
  "dine_in", "grab", "foodpanda", "eatigo", "whatsapp", "phone", "walkin",
];

const FAQ_CATEGORY_VALUES: FaqCategory[] = [
  "hours", "location", "parking", "halal", "dietary", "vip_rooms",
  "payment", "delivery", "birthday", "reservation_policy", "contact",
  "group_size", "dress_code", "cultural", "other",
];

const menuItemRowSchema = z.object({
  id: z.string().min(1),
  code: z.string().default(""),
  name_en: z.string().min(1),
  name_ko: z.string().default(""),
  name_zh: z.string().default(""),
  name_bm: z.string().default(""),
  price_rm: numberLike,
  category: z.enum(MENU_ITEM_CATEGORIES),
  portion: z.string().default(""),
  allergens: z.string().default(""),
  spice_level: numberLike,
  is_signature: boolLike,
  is_popular: boolLike,
  description_en: z.string().default(""),
  description_bm: z.string().default(""),
  description_zh: z.string().default(""),
  tags: z.string().default(""),
});

function parseMenuItemRow(
  row: Record<string, string>,
  sourceVersion: string,
  now: string,
): MenuItem {
  const parsed = menuItemRowSchema.parse(row);

  const allergens = splitList(parsed.allergens).filter((a): a is Allergen =>
    (ALLERGEN_VALUES as string[]).includes(a),
  );

  const spiceLevel: SpiceLevel =
    parsed.spice_level === 0 || parsed.spice_level === 1 ||
    parsed.spice_level === 2 || parsed.spice_level === 3
      ? (parsed.spice_level as SpiceLevel)
      : 0;

  return {
    id: parsed.id,
    code: parsed.code || null,
    names: {
      en: parsed.name_en,
      ...(parsed.name_bm && { bm: parsed.name_bm }),
      ...(parsed.name_zh && { zh: parsed.name_zh }),
      ...(parsed.name_ko && { ko: parsed.name_ko }),
    },
    priceRm: parsed.price_rm,
    category: parsed.category,
    portionDescription: parsed.portion,
    allergens,
    spiceLevel,
    isSignature: parsed.is_signature,
    isPopular: parsed.is_popular,
    description: {
      en: parsed.description_en,
      ...(parsed.description_bm && { bm: parsed.description_bm }),
      ...(parsed.description_zh && { zh: parsed.description_zh }),
    },
    photoUrl: null,
    tags: splitList(parsed.tags, /[;,]/),
    isActive: true,
    sourceVersion,
    updatedAt: now,
  };
}

const setRowSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  pax_min: numberLike,
  pax_max: numberLike,
  price_rm: numberLike,
  flags: z.string().default(""),
  description_en: z.string().default(""),
  description_zh: z.string().default(""),
  photo_url: z.string().default(""),
});

function parseSetRow(
  row: Record<string, string>,
  sourceVersion: string,
  now: string,
): MenuSet {
  const parsed = setRowSchema.parse(row);
  const flags = splitList(parsed.flags).filter((f): f is SetFlag =>
    (SET_FLAG_VALUES as string[]).includes(f),
  );

  return {
    id: parsed.id,
    code: parsed.code,
    name: parsed.name,
    paxMin: parsed.pax_min,
    paxMax: parsed.pax_max,
    priceRm: parsed.price_rm,
    includes: [],
    flags,
    description: {
      en: parsed.description_en,
      ...(parsed.description_zh && { zh: parsed.description_zh }),
    },
    photoUrl: parsed.photo_url || null,
    isActive: true,
    sourceVersion,
    updatedAt: now,
  };
}

const DISCOUNT_TYPE_VALUES = [
  "percent", "fixed_amount", "bogo", "free_item", "set_price",
] as const;

const APPLIES_TO_VALUES = [
  "all", "sets", "a_la_carte", "specific",
] as const;

const promoRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description_en: z.string().default(""),
  description_zh: z.string().default(""),
  discount_type: z.enum(DISCOUNT_TYPE_VALUES),
  discount_value: numberLike,
  applies_to: z.enum(APPLIES_TO_VALUES),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  days_of_week: z.string().default(""),
  time_window_start: z.string().default(""),
  time_window_end: z.string().default(""),
  channels: z.string().default(""),
  min_pax: z.string().default(""),
  terms: z.string().default(""),
});

function parsePromoRow(
  row: Record<string, string>,
  sourceVersion: string,
  now: string,
): Promo {
  const parsed = promoRowSchema.parse(row);

  const daysOfWeek = splitList(parsed.days_of_week)
    .map((d) => Number(d))
    .filter((d): d is 0 | 1 | 2 | 3 | 4 | 5 | 6 =>
      d === 0 || d === 1 || d === 2 || d === 3 || d === 4 || d === 5 || d === 6,
    );

  const channels = splitList(parsed.channels).filter((c): c is PromoChannel =>
    (PROMO_CHANNEL_VALUES as string[]).includes(c),
  );

  const timeWindow =
    parsed.time_window_start && parsed.time_window_end
      ? { startHhmm: parsed.time_window_start, endHhmm: parsed.time_window_end }
      : undefined;

  return {
    id: parsed.id,
    name: parsed.name,
    description: {
      en: parsed.description_en,
      ...(parsed.description_zh && { zh: parsed.description_zh }),
    },
    discountType: parsed.discount_type,
    discountValue: parsed.discount_value,
    appliesTo: parsed.applies_to,
    startDate: parsed.start_date,
    endDate: parsed.end_date,
    ...(daysOfWeek.length > 0 && { daysOfWeek }),
    ...(timeWindow && { timeWindow }),
    channels,
    terms: parsed.terms,
    ...(parsed.min_pax && { minPax: Number(parsed.min_pax) }),
    isActive: true,
    sourceVersion,
    updatedAt: now,
  };
}

const faqRowSchema = z.object({
  id: z.string().min(1),
  category: z.enum(FAQ_CATEGORY_VALUES),
  question: z.string().min(1),
  answer_en: z.string().min(1),
  answer_bm: z.string().default(""),
  answer_zh: z.string().default(""),
  keywords: z.string().default(""),
  priority: numberLike,
});

function parseFaqRow(
  row: Record<string, string>,
  sourceVersion: string,
  now: string,
): Faq {
  const parsed = faqRowSchema.parse(row);
  return {
    id: parsed.id,
    category: parsed.category,
    question: parsed.question,
    answers: {
      en: parsed.answer_en,
      ...(parsed.answer_bm && { bm: parsed.answer_bm }),
      ...(parsed.answer_zh && { zh: parsed.answer_zh }),
    },
    keywords: splitList(parsed.keywords),
    priority: parsed.priority || 5,
    isActive: true,
    sourceVersion,
    updatedAt: now,
  };
}

const LANGUAGE_VALUES: Language[] = ["en", "bm", "zh", "ko"];

const exampleRowSchema = z.object({
  id: z.string().min(1),
  scenario: z.string().min(1),
  language: z.enum(LANGUAGE_VALUES),
  customer_says: z.string().min(1),
  ideal_agent_reply: z.string().min(1),
  reasoning: z.string().default(""),
});

function parseExampleRow(
  row: Record<string, string>,
  sourceVersion: string,
  now: string,
): VoiceExample {
  const parsed = exampleRowSchema.parse(row);
  return {
    id: parsed.id,
    customerSays: parsed.customer_says,
    idealAgentReply: parsed.ideal_agent_reply,
    reasoning: parsed.reasoning,
    scenario: parsed.scenario,
    language: parsed.language,
    isActive: true,
    sourceVersion,
    updatedAt: now,
  };
}

// ── Main sync orchestrator ────────────────────────────────────
export interface SyncConfig {
  spreadsheetId: string;
  apiKey: string;
}

export interface SyncResult extends SyncStatus {
  durationMs: number;
}

export async function syncAll(
  config: SyncConfig,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<SyncResult> {
  const startedAt = Date.now();
  const now = new Date().toISOString();
  const sourceVersion = `sheet-${Date.now()}`;
  const errors: string[] = [];

  const counts = {
    items: 0,
    sets: 0,
    promos: 0,
    faqs: 0,
    examples: 0,
  };

  // Track IDs seen this sync — items not seen get soft-deleted
  const seenIds = {
    items: new Set<string>(),
    sets: new Set<string>(),
    promos: new Set<string>(),
    faqs: new Set<string>(),
    examples: new Set<string>(),
  };

  // Fetch + upsert each tab in parallel
  await Promise.all([
    syncTab("menu", config, async (rows) => {
      for (const row of rows) {
        try {
          const item = parseMenuItemRow(row, sourceVersion, now);
          seenIds.items.add(item.id);
          await upsertMenuItem(item, tenantId);
          counts.items++;
        } catch (err) {
          errors.push(`menu row ${row.id || "?"}: ${errorMessage(err)}`);
        }
      }
    }).catch((err) => errors.push(`menu tab: ${errorMessage(err)}`)),

    syncTab("sets", config, async (rows) => {
      for (const row of rows) {
        try {
          const set = parseSetRow(row, sourceVersion, now);
          seenIds.sets.add(set.id);
          await upsertMenuSet(set, tenantId);
          counts.sets++;
        } catch (err) {
          errors.push(`sets row ${row.id || "?"}: ${errorMessage(err)}`);
        }
      }
    }).catch((err) => errors.push(`sets tab: ${errorMessage(err)}`)),

    syncTab("promos", config, async (rows) => {
      for (const row of rows) {
        try {
          const promo = parsePromoRow(row, sourceVersion, now);
          seenIds.promos.add(promo.id);
          await upsertPromo(promo, tenantId);
          counts.promos++;
        } catch (err) {
          errors.push(`promos row ${row.id || "?"}: ${errorMessage(err)}`);
        }
      }
    }).catch((err) => errors.push(`promos tab: ${errorMessage(err)}`)),

    syncTab("faq", config, async (rows) => {
      for (const row of rows) {
        try {
          const faq = parseFaqRow(row, sourceVersion, now);
          seenIds.faqs.add(faq.id);
          await upsertFaq(faq, tenantId);
          counts.faqs++;
        } catch (err) {
          errors.push(`faq row ${row.id || "?"}: ${errorMessage(err)}`);
        }
      }
    }).catch((err) => errors.push(`faq tab: ${errorMessage(err)}`)),

    syncTab("examples", config, async (rows) => {
      for (const row of rows) {
        try {
          const example = parseExampleRow(row, sourceVersion, now);
          seenIds.examples.add(example.id);
          await upsertExample(example, tenantId);
          counts.examples++;
        } catch (err) {
          errors.push(`examples row ${row.id || "?"}: ${errorMessage(err)}`);
        }
      }
    }).catch((err) => errors.push(`examples tab: ${errorMessage(err)}`)),
  ]);

  // Soft-delete: items not seen in this sync
  const cols = menuCollections(tenantId);
  await softDeleteMissing(cols.menuItems, seenIds.items, sourceVersion, "items", tenantId);
  await softDeleteMissing(cols.menuSets, seenIds.sets, sourceVersion, "sets", tenantId);

  const status: SyncStatus = {
    lastSyncAt: now,
    lastSourceVersion: sourceVersion,
    itemCount: counts.items,
    setCount: counts.sets,
    promoCount: counts.promos,
    faqCount: counts.faqs,
    exampleCount: counts.examples,
    errors,
  };

  await saveSyncStatus(status, tenantId);

  return {
    ...status,
    durationMs: Date.now() - startedAt,
  };
}

async function syncTab(
  tabName: string,
  config: SyncConfig,
  handler: (rows: Record<string, string>[]) => Promise<void> | void,
): Promise<void> {
  const rows = await fetchSheetTab(config.spreadsheetId, tabName, config.apiKey);
  await handler(rows);
}

async function softDeleteMissing(
  collection: string,
  seenIds: Set<string>,
  sourceVersion: string,
  label: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<void> {
  const existing =
    label === "items"
      ? await getAllActiveMenuItems(tenantId)
      : label === "sets"
        ? await getAllActiveSets(tenantId)
        : [];

  const removedIds = existing
    .map((e) => e.id)
    .filter((id) => !seenIds.has(id));

  await Promise.all(
    removedIds.map((id) => markInactive(collection, id, sourceVersion)),
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return String(err).slice(0, 200);
}
