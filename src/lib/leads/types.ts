// Inbound sales leads from the /business marketing page contact form.
// These are F&B operators interested in the PaaS — DIFFERENT from
// CustomerProfile (customers of Songhwa itself).

export type LeadSource = "business_landing" | "api" | "manual";
export type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost";
export type LeadTier = "starter" | "growth" | "pro" | "enterprise" | "unsure";

export interface Lead {
  id: string;
  source: LeadSource;
  status: LeadStatus;
  restaurantName: string;
  contactName: string;
  contactRole?: string;
  email: string;
  phone: string;
  outlets: number;             // how many locations they run
  tier: LeadTier;
  cuisine?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
