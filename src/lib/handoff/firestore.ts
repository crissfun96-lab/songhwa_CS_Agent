import { getDb } from "../firebase-admin";
import { tc } from "../tenants/collection";
import { DEFAULT_TENANT_ID } from "../tenants/types";
import type {
  HandoffRequest,
  HandoffChannel,
  HandoffAction,
} from "./types";
import { HANDOFF_ETA_MINUTES } from "./types";

function generateTicketId(): string {
  const now = new Date();
  const yy = String(now.getFullYear() % 100).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const nnnn = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return `HO-${yy}${mm}${dd}-${nnnn}`;
}

export interface CreateHandoffInput {
  channel: HandoffChannel;
  customerName: string;
  customerPhone: string;
  reason: string;
  urgency?: "high" | "medium";
  sessionId?: string;
  vapiCallId?: string;
  tenantId?: string;
}

export async function createHandoff(input: CreateHandoffInput): Promise<HandoffRequest> {
  const tid = input.tenantId ?? DEFAULT_TENANT_ID;
  const handoffsCollection = tc(tid, "handoffs");
  const conversationsCollection = tc(tid, "conversations");

  const id = `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ticketId = generateTicketId();
  const urgency = input.urgency ?? "high";
  const now = new Date().toISOString();
  const staffPhone = process.env.STAFF_TRANSFER_PHONE?.trim() || null;

  // Decide the live action based on channel + capability
  let action: HandoffAction;
  let liveTransferTarget: string | undefined;
  if (input.channel === "phone" && staffPhone) {
    action = "transfer_now";
    liveTransferTarget = staffPhone;
  } else if (input.channel === "wa") {
    action = "human_mode";
  } else {
    // Web voice OR phone-without-staff-number → fall back to callback
    action = "callback_promised";
  }

  const request: HandoffRequest = {
    id,
    ticketId,
    channel: input.channel,
    customerName: input.customerName.slice(0, 120),
    customerPhone: input.customerPhone,
    reason: input.reason.slice(0, 500),
    urgency,
    status: action === "transfer_now" ? "transferring" : "pending",
    action,
    ...(liveTransferTarget && { liveTransferTarget }),
    assignedTo: null,
    resolutionNote: null,
    startedAt: now,
    resolvedAt: null,
    ...(input.sessionId && { sessionId: input.sessionId }),
    ...(input.vapiCallId && { vapiCallId: input.vapiCallId }),
    ...(input.channel === "wa" && { waConversationId: input.customerPhone }),
  };

  await getDb().collection(handoffsCollection).doc(id).set(request);

  // For WA: mark the customer's conversation as human-mode so the dispatcher
  // skips the AI for any further inbound messages from this number.
  if (action === "human_mode") {
    await getDb()
      .collection(conversationsCollection)
      .doc(input.customerPhone.replace(/\D/g, "") || "unknown")
      .set(
        {
          mode: "human",
          handoffTicketId: ticketId,
          assignedStaff: null,
          activatedAt: now,
          customerName: input.customerName,
        },
        { merge: true },
      );
  }

  return request;
}

export async function resolveHandoff(
  id: string,
  resolution: { resolvedBy: string; note?: string },
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<void> {
  const handoffsCollection = tc(tenantId, "handoffs");
  const conversationsCollection = tc(tenantId, "conversations");
  const ref = getDb().collection(handoffsCollection).doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Handoff not found");

  const data = doc.data() as HandoffRequest;
  await ref.update({
    status: "resolved",
    assignedTo: resolution.resolvedBy,
    resolutionNote: resolution.note ?? null,
    resolvedAt: new Date().toISOString(),
  });

  // Release the WA conversation back to AI mode
  if (data.action === "human_mode" && data.waConversationId) {
    await getDb()
      .collection(conversationsCollection)
      .doc(data.waConversationId.replace(/\D/g, "") || "unknown")
      .set(
        {
          mode: "ai",
          handoffTicketId: null,
          resolvedAt: new Date().toISOString(),
        },
        { merge: true },
      );
  }
}

// Used by the WA dispatcher to decide whether to invoke the AI or stay silent
// because a human is handling.
export async function getWaConversationMode(
  customerPhone: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<"ai" | "human"> {
  const docId = customerPhone.replace(/\D/g, "") || "unknown";
  const doc = await getDb()
    .collection(tc(tenantId, "conversations"))
    .doc(docId)
    .get();
  if (!doc.exists) return "ai";
  const data = doc.data();
  return data?.mode === "human" ? "human" : "ai";
}

export { HANDOFF_ETA_MINUTES };
