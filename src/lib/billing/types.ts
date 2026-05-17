// Stripe billing types — kept minimal so we can integrate Stripe without
// pulling the full SDK as a dependency (use REST directly, like Meta WA).

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "unpaid";

export interface BillingSubscription {
  tenantId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  priceId: string;          // Stripe price object
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
  updatedAt: string;
}
