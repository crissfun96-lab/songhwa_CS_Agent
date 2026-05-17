// Live human handoff — the "talk to a person RIGHT NOW" escape hatch.
//
// Distinct from request_human_callback (which is "call me back later"):
// handoff is realtime, urgent, and channel-aware.

export type HandoffChannel = "web" | "phone" | "wa";

export type HandoffStatus =
  | "pending"            // just created, waiting for staff to pick up
  | "transferring"       // phone call being bridged to staff
  | "human_mode"         // WA convo in human-only mode (AI silent)
  | "resolved"           // staff marked done
  | "abandoned";         // customer hung up / went idle before staff joined

export type HandoffAction =
  | "transfer_now"       // phone — voice infra will bridge to staff phone
  | "human_mode"         // wa — mark convo + alert staff to take over
  | "callback_promised"; // web — can't transfer, fall back to callback

export interface HandoffRequest {
  id: string;
  ticketId: string;                  // HO-YYMMDD-NNNNNN
  channel: HandoffChannel;
  customerName: string;
  customerPhone: string;
  reason: string;
  urgency: "high" | "medium";
  status: HandoffStatus;
  action: HandoffAction;
  liveTransferTarget?: string;       // staff phone for phone-channel transfers
  assignedTo: string | null;
  resolutionNote: string | null;
  startedAt: string;
  resolvedAt: string | null;
  // Session/source identifiers (channel-specific)
  sessionId?: string;                // web voice session ID
  vapiCallId?: string;               // Vapi-issued call ID for phone
  waConversationId?: string;         // customer's WA phone (acts as convo ID)
}

// Recommended SLAs for staff response by urgency
export const HANDOFF_ETA_MINUTES: Record<"high" | "medium", number> = {
  high: 5,
  medium: 15,
};
