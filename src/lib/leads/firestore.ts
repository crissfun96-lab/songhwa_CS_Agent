import { getDb } from "../firebase-admin";
import type { Lead, LeadTier } from "./types";

const COLLECTION = "foxie_leads";

export interface CreateLeadInput {
  restaurantName: string;
  contactName: string;
  contactRole?: string;
  email: string;
  phone: string;
  outlets: number;
  tier: LeadTier;
  cuisine?: string;
  notes?: string;
}

export async function createLead(input: CreateLeadInput): Promise<Lead> {
  const id = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const lead: Lead = {
    id,
    source: "business_landing",
    status: "new",
    restaurantName: input.restaurantName.slice(0, 200),
    contactName: input.contactName.slice(0, 120),
    contactRole: input.contactRole?.slice(0, 80),
    email: input.email.slice(0, 200),
    phone: input.phone.slice(0, 30),
    outlets: Math.max(1, Math.min(10000, input.outlets)),
    tier: input.tier,
    cuisine: input.cuisine?.slice(0, 80),
    notes: input.notes?.slice(0, 1000),
    createdAt: now,
    updatedAt: now,
  };
  await getDb().collection(COLLECTION).doc(id).set(lead);
  return lead;
}
