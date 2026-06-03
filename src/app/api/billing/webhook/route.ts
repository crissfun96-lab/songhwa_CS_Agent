// Stripe webhook — updates tenant subscription status, sends Telegram alerts.
// Configure in Stripe Dashboard → Developers → Webhooks → URL:
//   https://songhwa-cs-agent.vercel.app/api/billing/webhook
// Subscribe to: checkout.session.completed, customer.subscription.*, invoice.*

import { NextResponse } from "next/server";
import { verifyAndParseWebhook } from "@/lib/billing/stripe";
import { updateTenant } from "@/lib/tenants/firestore";
import { sendToStaffRaw } from "@/lib/telegram";
import { log } from "@/lib/logger";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  const event = verifyAndParseWebhook(rawBody, signature);
  if (!event) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const type = String(event.type);
  const data = (event.data as { object: Record<string, unknown> })?.object ?? {};
  const metadata = (data.metadata as Record<string, string>) ?? {};
  const tenantId = metadata.tenantId;

  try {
    switch (type) {
      case "checkout.session.completed": {
        if (tenantId) {
          await updateTenant(tenantId, {
            status: "active",
            stripeCustomerId: String(data.customer ?? ""),
            stripeSubscriptionId: String(data.subscription ?? ""),
          });
          sendToStaffRaw(
            `💳 <b>Subscription started</b>\n\nTenant: <code>${tenantId}</code>\nAmount: ${String(data.amount_total ?? "?")} ${String(data.currency ?? "")}\nCustomer: ${String(data.customer_details ? (data.customer_details as { email?: string }).email : "?")}`,
          ).catch(() => {});
        }
        break;
      }
      case "customer.subscription.deleted": {
        if (tenantId) {
          await updateTenant(tenantId, { status: "cancelled" });
          sendToStaffRaw(`❌ <b>Subscription cancelled</b>\n\nTenant: <code>${tenantId}</code>`).catch(() => {});
        }
        break;
      }
      case "invoice.payment_failed": {
        if (tenantId) {
          await updateTenant(tenantId, { status: "suspended" });
          sendToStaffRaw(`⚠️ <b>Payment failed</b>\n\nTenant: <code>${tenantId}</code> — suspending until resolved.`).catch(() => {});
        }
        break;
      }
      default:
        // Ignore other event types for now
        break;
    }
  } catch (err) {
    log.error({ event: "stripe_webhook_handler_error", err, tenantId });
    // Return 500 so Stripe retries (up to 72h). A failed updateTenant means
    // subscription state did NOT propagate to Firestore — silently swallowing
    // this leaves a paid customer in the wrong state forever.
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
