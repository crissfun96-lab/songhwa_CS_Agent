import { getDb } from "../firebase-admin";
import {
  DEFAULT_TENANT_ID,
  TIER_LIMITS,
  type Tenant,
  type TenantStatus,
  type TenantTier,
} from "./types";

const COLLECTION = "foxie_tenants";

// Slugs we never let a tenant claim. "wa" would collide with the `wa_*`
// prefix swap inside `tc()`, producing malformed collection names.
const RESERVED_TENANT_SLUGS = new Set([DEFAULT_TENANT_ID, "wa"]);

// Firestore "already exists" error code shape (Admin SDK uses gRPC code 6 or
// the string "already-exists" depending on version).
function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists";
}

// Small in-memory LRU cache — tenant config is read on every request, so we
// don't want to hit Firestore each time. Refresh every 60 seconds.
// NOTE: cache is per-Vercel-container; status changes can lag up to 60s
// across other containers (acceptable today; consider Redis/KV at scale).
const TTL_MS = 60_000;
const cache = new Map<string, { tenant: Tenant; expiresAt: number }>();

export async function getTenant(tenantId: string): Promise<Tenant | null> {
  const tid = (tenantId || DEFAULT_TENANT_ID).toLowerCase();
  const cached = cache.get(tid);
  if (cached && cached.expiresAt > Date.now()) return cached.tenant;

  const doc = await getDb().collection(COLLECTION).doc(tid).get();
  if (!doc.exists) return null;
  const tenant = doc.data() as Tenant;
  cache.set(tid, { tenant, expiresAt: Date.now() + TTL_MS });
  return tenant;
}

export async function getOrSeedSonghwa(): Promise<Tenant> {
  const existing = await getTenant(DEFAULT_TENANT_ID);
  if (existing) return existing;

  const now = new Date().toISOString();
  const seed: Tenant = {
    id: DEFAULT_TENANT_ID,
    slug: DEFAULT_TENANT_ID,
    status: "active",
    tier: "pro",
    business: {
      legalName: "Songhwa Korean Cuisine Sdn Bhd",
      displayName: "Songhwa Korean Cuisine",
      address: "Level 8, Millerz Square, Old Klang Road, Kuala Lumpur",
      phone: "+60 11-5430 2561",
      cuisine: "Korean BBQ",
      hoursText: "Daily 11:30 AM-3:00 PM, 5:30 PM-10:00 PM",
    },
    notif: {
      telegram: undefined,
      whatsappStaffGroup: "Songhwa Reservations",
    },
    promptOverrides: {
      cuisine: "Korean BBQ",
      halalStatus: "non_halal",
      languages: ["en", "zh", "ms", "ko"],
      toneNotes: "warm, professional, mirror customer's language exactly",
    },
    ownerEmail: "crissfun96@gmail.com",
    ownerName: "Chris Fun",
    contacts: [],
    createdAt: now,
    updatedAt: now,
  };

  const ref = getDb().collection(COLLECTION).doc(DEFAULT_TENANT_ID);
  try {
    await ref.create(seed);
  } catch (err) {
    if (isAlreadyExists(err)) {
      // Lost the race against another container — re-fetch the winner.
      const doc = await ref.get();
      const tenant = doc.data() as Tenant;
      cache.set(DEFAULT_TENANT_ID, { tenant, expiresAt: Date.now() + TTL_MS });
      return tenant;
    }
    throw err;
  }
  cache.set(DEFAULT_TENANT_ID, { tenant: seed, expiresAt: Date.now() + TTL_MS });
  return seed;
}

export interface CreateTenantInput {
  slug: string;
  tier: TenantTier;
  businessName: string;
  address?: string;
  phone: string;
  cuisine?: string;
  ownerEmail: string;
  ownerName: string;
}

export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  const slug = input.slug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  if (!slug || RESERVED_TENANT_SLUGS.has(slug)) {
    throw new Error(`Invalid slug — reserved or empty: '${slug}'`);
  }

  const now = new Date().toISOString();
  const trialEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const tenant: Tenant = {
    id: slug,
    slug,
    status: "trial",
    tier: input.tier,
    trialEndsAt: trialEnds,
    business: {
      legalName: input.businessName,
      displayName: input.businessName,
      address: input.address ?? "",
      phone: input.phone,
      cuisine: input.cuisine,
    },
    notif: {},
    promptOverrides: {
      cuisine: input.cuisine,
      languages: ["en", "ms"],
    },
    ownerEmail: input.ownerEmail,
    ownerName: input.ownerName,
    contacts: [input.ownerEmail],
    createdAt: now,
    updatedAt: now,
  };

  try {
    await getDb().collection(COLLECTION).doc(slug).create(tenant);
  } catch (err) {
    if (isAlreadyExists(err)) {
      throw new Error(`Tenant slug '${slug}' already taken`);
    }
    throw err;
  }
  cache.delete(slug);
  return tenant;
}

// Narrow patch type — only scalar fields. Nested objects (business, notif,
// promptOverrides) are deliberately excluded because Firestore `.update()`
// REPLACES nested maps instead of merging them. To update a nested field,
// add a dedicated updater that uses dot-notation paths.
export interface TenantScalarPatch {
  status?: TenantStatus;
  tier?: TenantTier;
  trialEndsAt?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  googleSheetsId?: string;
  googleSheetsApiKey?: string;
  googlePlaceId?: string;
  ownerEmail?: string;
  ownerName?: string;
}

export async function updateTenant(
  tenantId: string,
  patch: TenantScalarPatch,
): Promise<void> {
  const tid = tenantId.toLowerCase();
  await getDb().collection(COLLECTION).doc(tid).update({
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  cache.delete(tid);
}

// List every tenant that should be actively processed (status "trial" or
// "active"). Used by the WA dispatch + queue-health crons to sweep all tenants.
//
// CRITICAL: the default tenant (Songhwa) is ALWAYS included, even before any
// `foxie_tenants` docs exist — so production keeps running on day one. We
// prepend the seeded Songhwa tenant if the query didn't already return it,
// then dedupe by id.
export async function listActiveTenants(): Promise<Tenant[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .where("status", "in", ["trial", "active"])
    .get();

  const tenants = snap.docs.map((doc) => doc.data() as Tenant);

  // Immutable: prepend the seeded Songhwa tenant only if absent (no mutation).
  const withDefault = tenants.some((t) => t.id === DEFAULT_TENANT_ID)
    ? tenants
    : [await getOrSeedSonghwa(), ...tenants];

  // Dedupe by id (defensive — guards against a duplicate Songhwa doc).
  const byId = new Map<string, Tenant>();
  for (const t of withDefault) {
    if (!byId.has(t.id)) byId.set(t.id, t);
  }
  return [...byId.values()];
}

export function effectiveLimits(tenant: Tenant) {
  return { ...TIER_LIMITS[tenant.tier], ...tenant.customLimits };
}
