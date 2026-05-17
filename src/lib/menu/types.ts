// Songhwa menu knowledge system — Firestore schema
// Source of truth: Google Sheet → synced every 5 min → Firestore → injected to Gemini Live
//
// Design notes:
// - All prices in RM (Ringgit Malaysia), stored as number (not string — enables filters)
// - Soft-delete via `isActive` flag (never hard-delete — preserves reservation history)
// - `updatedAt` tracks sync freshness; stale data > 10 min triggers alert
// - `sourceVersion` lets us know which Sheet revision produced each record

export type Language = "en" | "bm" | "zh" | "ko";

export type DishCategory =
  | "bbq"
  | "stew_soup"
  | "rice_noodles"
  | "appetizer_side"
  | "pancake"
  | "fried_chicken"
  | "dessert"
  | "beverage"
  | "add_on";

export type SpiceLevel = 0 | 1 | 2 | 3; // 0 = none, 3 = very spicy

export type Allergen =
  | "pork"
  | "beef"
  | "chicken"
  | "seafood"
  | "fish"
  | "shellfish"
  | "egg"
  | "dairy"
  | "gluten"
  | "soy"
  | "sesame"
  | "peanut"
  | "tree_nut"
  | "alcohol";

// ── Individual menu item (a la carte) ──────────────────────────
export interface MenuItem {
  id: string;                    // stable ID, e.g. "bbq_pork_belly"
  code: string | null;           // printed menu code, e.g. "B1", or null
  names: {
    en: string;
    bm?: string;
    zh?: string;
    ko?: string;
  };
  priceRm: number;               // single source of truth for price
  category: DishCategory;
  portionDescription: string;    // "150g", "serves 2", "8 pcs"
  allergens: Allergen[];
  spiceLevel: SpiceLevel;
  isSignature: boolean;          // highlight in recommendations
  isPopular: boolean;            // Top 10
  description: {
    en: string;
    bm?: string;
    zh?: string;
  };
  photoUrl: string | null;       // Firebase Storage URL
  tags: string[];                // searchable — "spicy", "grilled", "rice", "hot-pot"
  isActive: boolean;
  sourceVersion: string;         // Sheet revision ID
  updatedAt: string;             // ISO 8601
}

// ── Set meal (M1–M8 + future) ─────────────────────────────────
export interface MenuSet {
  id: string;                    // "M2", "M5", etc.
  code: string;                  // same as id typically
  name: string;                  // "Korean Full Course Meal (4-5 pax)"
  paxMin: number;
  paxMax: number;
  priceRm: number;
  includes: SetInclusion[];      // structured, not prose
  flags: SetFlag[];              // "best_seller", "super_value", "couples_choice"
  description: {
    en: string;
    bm?: string;
    zh?: string;
  };
  photoUrl: string | null;
  isActive: boolean;
  sourceVersion: string;
  updatedAt: string;
}

export type SetFlag =
  | "best_seller"
  | "super_value"
  | "couples_choice"
  | "premium"
  | "budget"
  | "new";

export interface SetInclusion {
  category: "starter" | "soup" | "main" | "bbq" | "pancake" | "rice" | "dessert" | "beverage";
  description: string;           // "BBQ Pork Belly x2"
  isChoice: boolean;             // true = customer picks from options
  choices?: string[];            // if isChoice, list options
  upgradePriceRm?: number;       // optional upgrade cost
}

// ── Promos ─────────────────────────────────────────────────────
export interface Promo {
  id: string;
  name: string;                  // "Weekend BOGO", "Eatigo Early Dinner"
  description: {
    en: string;
    bm?: string;
    zh?: string;
  };
  discountType: "percent" | "fixed_amount" | "bogo" | "free_item" | "set_price";
  discountValue: number;         // e.g. 50 for "50% off", 20 for "RM 20 off"
  appliesTo: "all" | "sets" | "a_la_carte" | "specific";
  specificItemIds?: string[];    // when appliesTo = "specific"
  startDate: string;             // ISO date, e.g. "2026-04-01"
  endDate: string;               // ISO date
  daysOfWeek?: (0 | 1 | 2 | 3 | 4 | 5 | 6)[]; // 0 = Sunday
  timeWindow?: { startHhmm: string; endHhmm: string }; // e.g. 11:30-13:00
  channels: PromoChannel[];      // where promo is valid
  terms: string;                 // fine print
  minPax?: number;
  maxRedemptionsPerCustomer?: number;
  isActive: boolean;
  sourceVersion: string;
  updatedAt: string;
}

export type PromoChannel =
  | "dine_in"
  | "grab"
  | "foodpanda"
  | "eatigo"
  | "whatsapp"
  | "phone"
  | "walkin";

// ── FAQ (hours, parking, halal, VIP rooms, etc.) ───────────────
export interface Faq {
  id: string;
  category: FaqCategory;
  question: string;
  answers: {
    en: string;
    bm?: string;
    zh?: string;
  };
  keywords: string[];            // for fuzzy match
  priority: number;              // 1 = always include, 10 = rarely
  isActive: boolean;
  sourceVersion: string;
  updatedAt: string;
}

export type FaqCategory =
  | "hours"
  | "location"
  | "parking"
  | "halal"
  | "dietary"
  | "vip_rooms"
  | "payment"
  | "delivery"
  | "birthday"
  | "reservation_policy"
  | "contact"
  | "group_size"
  | "dress_code"
  | "cultural"
  | "other";

// ── Few-shot examples (teaches voice/tone, not data) ──────────
export interface VoiceExample {
  id: string;
  customerSays: string;
  idealAgentReply: string;
  reasoning: string;             // why this reply is good
  scenario: string;              // "reservation", "recommendation", "complaint", etc.
  language: Language;
  isActive: boolean;
  sourceVersion: string;
  updatedAt: string;
}

// ── Dish photos (separate — photos update independently) ──────
export interface DishPhoto {
  dishId: string;                // matches MenuItem.id or MenuSet.id
  url: string;                   // Firebase Storage or CDN
  caption: string;
  isHero: boolean;               // primary photo
  uploadedAt: string;
}

// ── Sync metadata ─────────────────────────────────────────────
export interface SyncStatus {
  lastSyncAt: string;
  lastSourceVersion: string;
  itemCount: number;
  setCount: number;
  promoCount: number;
  faqCount: number;
  exampleCount: number;
  errors: string[];
}

// ── Compact menu summary (injected into system prompt) ────────
// Keep this small — target < 3K tokens
export interface CompactMenuSummary {
  generatedAt: string;
  sets: Array<{
    code: string;
    name: string;
    pax: string;                 // "4-5", "8-10"
    priceRm: number;
    flags: SetFlag[];
    oneLineDescription: string;
  }>;
  signatureDishes: Array<{
    id: string;
    name: string;
    priceRm: number;
    category: DishCategory;
  }>;
  activePromos: Array<{
    name: string;
    summary: string;
    endDate: string;
  }>;
  keyFaqs: Array<{               // priority <= 3
    question: string;
    answer: string;
  }>;
}
