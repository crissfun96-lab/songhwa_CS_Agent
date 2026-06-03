// Decides what to actually send the customer after the WhatsApp tool-call loop.
//
// Why this exists: the dispatcher's tool loop is bounded (MAX_TOOL_ROUNDS). If a
// booking-mutating tool (create/update/cancel) is the call on the FINAL round, the
// loop exits before the model gets a turn to produce confirmation text — leaving
// `finalText` null. The old code then sent a generic "sorry, having trouble" message
// even though the booking had just succeeded in Firestore. A human host would never
// tell a guest their booking failed seconds after writing it. This function guarantees
// that when a mutation just succeeded, the customer is CONFIRMED, never told it failed.

export const GENERIC_FAILURE =
  "Sorry, I'm having trouble processing that. Please try again or call us at +60 11-5430 2561.";

const MUTATING_TOOLS = new Set([
  "create_reservation",
  "update_reservation",
  "cancel_reservation",
]);

export interface ToolOutcome {
  name: string;
  result: Record<string, unknown>;
}

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

// A booking-mutating tool result counts as success if it carries saved:true
// (create_reservation) or success:true (update/cancel route responses).
export function mutationSucceeded(result: Record<string, unknown> | undefined): boolean {
  if (!result) return false;
  return result.saved === true || result.success === true;
}

// Resolve the final customer-facing reply.
//  1. If the model produced text, always use it.
//  2. Else, if the last booking-mutating tool SUCCEEDED, send a confirmation
//     (the tool's own `message` if present, otherwise a safe per-tool fallback) —
//     NEVER the generic failure line.
//  3. Otherwise fall back to the generic failure line.
export function resolveFinalReply(
  finalText: string | null | undefined,
  lastMutation: ToolOutcome | null,
): string {
  if (finalText && finalText.trim()) return finalText;

  if (lastMutation && isMutatingTool(lastMutation.name) && mutationSucceeded(lastMutation.result)) {
    const msg = lastMutation.result.message;
    if (typeof msg === "string" && msg.trim()) return msg;
    if (lastMutation.name === "update_reservation") {
      return "✅ Done — your reservation has been updated. Anything else I can help with?";
    }
    if (lastMutation.name === "cancel_reservation") {
      return "✅ Your reservation has been cancelled. Hope to see you again soon!";
    }
    return "✅ Your reservation is confirmed. Our staff have been notified.";
  }

  return GENERIC_FAILURE;
}
