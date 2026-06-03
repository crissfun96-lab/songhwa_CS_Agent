// Tenant = one F&B operator on the Foxie PaaS.
// Songhwa is the first/default tenant; new tenants onboard via /business/signup.

export type TenantTier = "starter" | "growth" | "pro" | "enterprise";
export type TenantStatus = "trial" | "active" | "suspended" | "cancelled";

export interface TenantLimits {
  voiceMinutesPerMonth: number;        // includes web + phone
  waConversationsPerMonth: number;     // 0 = no WA, -1 = unlimited
  outlets: number;                     // max outlets covered
}

export const TIER_LIMITS: Record<TenantTier, TenantLimits> = {
  starter:    { voiceMinutesPerMonth: 200,    waConversationsPerMonth: 500,    outlets: 1 },
  growth:     { voiceMinutesPerMonth: 1500,   waConversationsPerMonth: -1,     outlets: 3 },
  pro:        { voiceMinutesPerMonth: 6000,   waConversationsPerMonth: -1,     outlets: 999 },
  enterprise: { voiceMinutesPerMonth: -1,     waConversationsPerMonth: -1,     outlets: 999 },
};

export const TIER_PRICE_MYR: Record<TenantTier, number> = {
  starter: 299,
  growth: 899,
  pro: 2499,
  enterprise: 0, // custom — invoice
};

export interface TenantNotifChannels {
  telegram?: { botToken: string; chatId: string };
  whatsappStaffGroup?: string;              // WA group name for Baileys (or null)
  metaWhatsappPhoneId?: string;             // for customer-facing WA via Meta Cloud
  staffTransferPhone?: string;              // live phone-handoff target (E.164)
}

export interface TenantPromptOverrides {
  cuisine?: string;                          // "Korean BBQ", "Italian pizza", etc.
  halalStatus?: "halal" | "non_halal" | "muslim_friendly";
  languages?: string[];                      // ["en", "zh", "ms", "ko"]
  toneNotes?: string;                        // "warm and casual" / "premium and formal"
  additionalRules?: string;                  // free-text appended after the safety block
  systemPromptTemplate?: string;             // full white-label override of BASE_PROMPT_TEMPLATE
}

export interface TenantTheme {
  brandName?: string;                        // override `business.displayName` for UI
  logoUrl?: string;                          // public URL — used by /admin and /business
  faviconUrl?: string;
  primaryColor?: string;                     // hex e.g. "#0a8a3c"
  accentColor?: string;
  fontFamily?: string;                       // e.g. "Inter, system-ui"
  ctaPrimary?: string;                       // landing CTA copy ("Try the demo")
  marketingTagline?: string;                 // sub-headline on `/business`
}

export interface TenantBusinessInfo {
  legalName: string;
  displayName: string;
  address: string;
  phone: string;                             // public phone
  cuisine?: string;
  hoursText?: string;                        // "Mon-Sun 11:30-15:00, 17:30-22:00"
}

// Per-tenant booking capacity overrides (admin-editable). All optional — any unset
// field falls back to the availability engine's DEFAULT_CAPACITY, so an empty/absent
// object means "use the defaults" (Songhwa's original hardcoded values).
export interface TenantCapacity {
  lunchCap?: number;            // max concurrent pax during the lunch service
  dinnerCap?: number;           // max concurrent pax during the dinner service
  lunchTurnMinutes?: number;    // how long a lunch table is held
  dinnerTurnMinutes?: number;   // how long a dinner table is held
}

export interface Tenant {
  id: string;                                // "songhwa" / "acme" — lowercase, URL-safe
  slug: string;                              // same as id, kept for clarity
  status: TenantStatus;
  tier: TenantTier;
  customLimits?: Partial<TenantLimits>;      // override TIER_LIMITS per-tenant
  capacity?: TenantCapacity;                 // override booking caps + turn times
  trialEndsAt?: string;                      // ISO; for trial tenants

  business: TenantBusinessInfo;
  notif: TenantNotifChannels;
  promptOverrides: TenantPromptOverrides;
  theme?: TenantTheme;

  // Data integrations
  googleSheetsId?: string;                   // their menu Sheet ID
  googleSheetsApiKey?: string;               // their API key (or use platform shared)
  googlePlaceId?: string;                    // for hours sync

  // Billing
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;

  // Admin
  ownerEmail: string;
  ownerName: string;
  contacts: string[];                        // additional admin emails

  createdAt: string;
  updatedAt: string;
}

// Songhwa default tenant — used for all queries when no tenantId is resolved.
// Keeps existing songhwa_* collections working with zero migration.
export const DEFAULT_TENANT_ID = "songhwa";
