import { getDb } from "../firebase-admin";
import { DEFAULT_TENANT_ID, TIER_LIMITS, type Tenant, type TenantTier } from "./types";

const COLLECTION = "foxie_tenants";

// Small in-memory LRU cache — tenant config is read on every request, so we
// don't want to hit Firestore each time. Refresh every 60 seconds.
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
    tier: "pro", // Songhwa is the showcase tenant — pro tier, unlimited everything
    business: {
      legalName: "Songhwa Korean Cuisine Sdn Bhd",
      displayName: "Songhwa Korean Cuisine",
      address: "Level 8, Millerz Square, Old Klang Road, Kuala Lumpur",
      phone: "+60 11-5430 2561",
      cuisine: "Korean BBQ",
      hoursText: "Daily 11:30 AM-3:00 PM, 5:30 PM-10:00 PM",
    },
    notif: {
      telegram: undefined, // uses platform env vars
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
  await getDb().collection(COLLECTION).doc(DEFAULT_TENANT_ID).set(seed);
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
  if (!slug || slug === DEFAULT_TENANT_ID) {
    throw new Error("Invalid slug — must be lowercase, alphanumeric, not 'songhwa'");
  }

  const existing = await getDb().collection(COLLECTION).doc(slug).get();
  if (existing.exists) throw new Error(`Tenant slug '${slug}' already taken`);

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
  await getDb().collection(COLLECTION).doc(slug).set(tenant);
  cache.delete(slug);
  return tenant;
}

export async function updateTenant(
  tenantId: string,
  patch: Partial<Tenant>,
): Promise<void> {
  const tid = tenantId.toLowerCase();
  await getDb().collection(COLLECTION).doc(tid).update({
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  cache.delete(tid);
}

export function effectiveLimits(tenant: Tenant) {
  return { ...TIER_LIMITS[tenant.tier], ...tenant.customLimits };
}
