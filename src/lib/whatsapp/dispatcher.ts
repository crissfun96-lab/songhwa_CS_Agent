// WhatsApp dispatcher — the AI brain for inbound WA messages.
//
// Flow:
//   1. Inbound WA message lands in wa_inbound_messages (via webhook)
//   2. This dispatcher reads unprocessed messages
//   3. For each: check conversation mode — skip if 'human' (handoff active)
//   4. Otherwise: load history, append user msg, call Gemini Flash with 14 tools
//   5. If tool call → invoke (HTTP self-call), append result, loop max 4 times
//   6. Final text → send via Meta Cloud API, append to history, mark processed
//
// Real-time delivery comes from the webhook's fire-and-forget trigger. The
// Vercel cron is a daily safety-net sweep (Vercel Hobby allows only daily
// crons). Both can run concurrently, so each message is CLAIMED in a Firestore
// transaction before processing — this serializes the two paths so no message
// is ever double-replied.

import { log } from "@/lib/logger";
import { getDb } from "../firebase-admin";
import { loadHistory, appendMessage, type ConvMessage } from "./conversation";
import { callGemini, toGeminiContents } from "./gemini-text";
import { sendText } from "./meta-client";
import { resolveFinalReply, isMutatingTool, type ToolOutcome } from "./reply-resolution";
import { getWaConversationMode } from "../handoff/firestore";
import { buildSystemPrompt, TOOL_DECLARATIONS } from "../menu/prompt-injector";
import { tc } from "../tenants/collection";
import { DEFAULT_TENANT_ID } from "../tenants/types";
import { tenantServiceState } from "../billing/lifecycle";

// Bumped 4→6: a normal booking can chain lookup_customer → check_availability →
// save_reservation_draft → create_reservation and still need a round for the model
// to speak the confirmation. 4 was too tight (booking could succeed but the loop exit
// silent → customer wrongly told it failed). resolveFinalReply is the belt-and-braces.
const MAX_TOOL_ROUNDS = 6;

interface InboundMessage {
  id: string;
  metaMessageId: string;
  from: string;
  customerName: string | null;
  type: string;
  text: string | null;
  audioMediaId: string | null;
  receivedAt: string;
  metaTimestamp: string;
  phoneNumberId: string;
  processed: boolean;
  processingError?: string;
  processing?: boolean;
  claimedAt?: string;
  // Set when the reply was computed but DELIVERY failed (transient Meta outage). A
  // later run re-sends this verbatim without re-running the model loop (idempotent retry).
  pendingReply?: string;
}

// A message whose `claimedAt` is older than this is treated as a stale claim
// (the claiming run probably crashed mid-flight) and may be re-claimed.
const STALE_CLAIM_MS = 5 * 60 * 1000;

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "https://songhwa-cs-agent.vercel.app";

// Build the internal-call headers — forwards tenant context with a secret
// so resolveTenantId() on the receiving end honors X-Foxie-Tenant.
function internalHeaders(tenantId: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: APP_BASE_URL,
    "User-Agent": "songhwa-wa-dispatcher/1",
    "X-Foxie-Tenant": tenantId,
  };
  const secret = process.env.FOXIE_INTERNAL_SECRET?.trim();
  if (secret) headers["X-Foxie-Internal-Secret"] = secret;
  return headers;
}

// Server-side tool execution — calls our own deployed endpoints with
// Origin allowed so the WA tenant uses the same code paths as web voice.
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  sessionId: string,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const enc = encodeURIComponent;
  const baseHeaders = internalHeaders(tenantId);

  try {
    switch (name) {
      case "lookup_customer": {
        const phoneArg = String(args.phone ?? "");
        const nameArg = String(args.name ?? "");
        const param = phoneArg ? `phone=${enc(phoneArg)}` : `name=${enc(nameArg)}`;
        const r = await fetch(`${APP_BASE_URL}/api/customers?${param}`, { headers: baseHeaders });
        return (await r.json())?.data ?? { found: false };
      }
      case "get_business_status": {
        const r = await fetch(`${APP_BASE_URL}/api/business/status`, { headers: baseHeaders });
        return (await r.json())?.data ?? {};
      }
      case "search_menu": {
        const r = await fetch(`${APP_BASE_URL}/api/menu/search?q=${enc(String(args.query ?? ""))}`, { headers: baseHeaders });
        return (await r.json())?.data ?? { results: [] };
      }
      case "get_dish_details": {
        const r = await fetch(`${APP_BASE_URL}/api/menu/dish?id=${enc(String(args.id ?? ""))}`, { headers: baseHeaders });
        return (await r.json())?.data ?? { error: "not_found" };
      }
      case "get_active_promos": {
        const r = await fetch(`${APP_BASE_URL}/api/menu/promos`, { headers: baseHeaders });
        return (await r.json())?.data ?? [];
      }
      case "check_allergens": {
        const r = await fetch(`${APP_BASE_URL}/api/menu/allergens?id=${enc(String(args.id ?? ""))}`, { headers: baseHeaders });
        return (await r.json())?.data ?? {};
      }
      case "check_availability": {
        const url = `${APP_BASE_URL}/api/availability?date=${enc(String(args.date ?? ""))}&time=${enc(String(args.time ?? ""))}&pax=${enc(String(args.pax ?? ""))}`;
        const r = await fetch(url, { headers: baseHeaders });
        return (await r.json())?.data ?? {};
      }
      case "save_reservation_draft": {
        const r = await fetch(`${APP_BASE_URL}/api/reservations/draft`, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify({
            sessionId,
            name: args.name,
            phone: args.phone,
            date: args.date,
            time: args.time,
            pax: args.pax,
            menuChoice: args.menu_choice,
            remarks: args.remarks,
          }),
        });
        return (await r.json())?.data ?? { saved: false };
      }
      case "find_reservation": {
        const phone = String(args.phone ?? "");
        const date = args.date ? `&date=${enc(String(args.date))}` : "";
        const r = await fetch(`${APP_BASE_URL}/api/reservations/find?phone=${enc(phone)}${date}`, { headers: baseHeaders });
        const j = await r.json();
        return { count: j.count ?? 0, reservations: j.data ?? [] };
      }
      case "create_reservation": {
        const r = await fetch(`${APP_BASE_URL}/api/reservations`, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify({
            sessionId,
            name: String(args.name ?? ""),
            phone: String(args.phone ?? ""),
            date: String(args.date ?? ""),
            time: String(args.time ?? ""),
            pax: Number(args.pax ?? 0),
            menuChoice: String(args.menu_choice ?? ""),
            remarks: String(args.remarks ?? ""),
          }),
        });
        const j = await r.json();
        return j.success
          ? { saved: true, message: `Booking confirmed for ${args.name}, ${args.pax} pax on ${args.date} at ${args.time}. Staff notified.` }
          : { saved: false, ...j };
      }
      case "update_reservation": {
        const id = String(args.id ?? "");
        const payload: Record<string, unknown> = { sessionId };
        for (const k of ["phone", "date", "time", "pax", "reason"] as const) {
          if (args[k] !== undefined) payload[k] = args[k];
        }
        if (args.menu_choice !== undefined) payload.menuChoice = args.menu_choice;
        if (args.remarks !== undefined) payload.remarks = args.remarks;
        const r = await fetch(`${APP_BASE_URL}/api/reservations/${enc(id)}`, {
          method: "PATCH",
          headers: baseHeaders,
          body: JSON.stringify(payload),
        });
        return await r.json();
      }
      case "cancel_reservation": {
        const id = String(args.id ?? "");
        const r = await fetch(`${APP_BASE_URL}/api/reservations/${enc(id)}`, {
          method: "DELETE",
          headers: baseHeaders,
          body: JSON.stringify({
            sessionId,
            phone: args.phone,
            reason: args.reason,
          }),
        });
        return await r.json();
      }
      case "file_complaint": {
        const r = await fetch(`${APP_BASE_URL}/api/complaints`, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify(args),
        });
        return (await r.json())?.data ?? { filed: false };
      }
      case "request_human_callback": {
        const r = await fetch(`${APP_BASE_URL}/api/callbacks`, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify(args),
        });
        return (await r.json())?.data ?? { queued: false };
      }
      case "request_human_handoff": {
        const r = await fetch(`${APP_BASE_URL}/api/handoff`, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify({ ...args, channel: "wa", sessionId }),
        });
        return (await r.json())?.data ?? { handoff_failed: true };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 200) : "Tool call failed" };
  }
}

export async function processInboundMessage(
  msg: InboundMessage,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<{
  ok: boolean;
  replyText?: string;
  error?: string;
  // true = transient DELIVERY failure; the message must NOT be marked processed, and
  // replyText should be persisted as pendingReply for a later idempotent re-send.
  retryable?: boolean;
}> {
  // Skip non-text messages for now (audio support comes later via Mesolitica/Deepgram)
  if (msg.type !== "text" || !msg.text?.trim()) {
    return { ok: true, replyText: undefined };
  }

  // IDEMPOTENT RETRY FAST-PATH — a prior run computed the reply but failed to DELIVER it
  // (e.g. a transient Meta outage). Re-send verbatim; do NOT re-run the model loop or
  // re-append the user turn (the booking, if any, already committed on the first run).
  if (msg.pendingReply && msg.pendingReply.trim()) {
    try {
      await sendText(msg.from, msg.pendingReply);
      await appendMessage(
        msg.from,
        { role: "model", text: msg.pendingReply, at: new Date().toISOString() },
        undefined,
        tenantId,
      );
      return { ok: true, replyText: msg.pendingReply };
    } catch (err) {
      log.warn({ event: "wa_reply_resend_failed", phone: msg.from, err, tenantId });
      return { ok: false, retryable: true, replyText: msg.pendingReply, error: "send_retry_failed" };
    }
  }

  // Check conversation mode — silent if human handoff is active
  const mode = await getWaConversationMode(msg.from, tenantId);
  if (mode === "human") {
    return { ok: true, error: "human_mode — AI silent" };
  }

  // Billing gate: if this tenant isn't serviceable (suspended / cancelled /
  // trial expired / over quota), skip SILENTLY — never reply, so we don't
  // spam a suspended tenant's customers. Fail-open keeps active tenants live.
  const s = await tenantServiceState(tenantId);
  if (!s.serviceable) {
    return { ok: true, error: `service_${s.reason} — skipped` };
  }

  const customerPhone = msg.from;
  const sessionId = `wa_${customerPhone.replace(/\D/g, "")}`;

  // Load conversation history + build prompt
  const [history, systemPrompt] = await Promise.all([
    loadHistory(customerPhone, tenantId),
    buildSystemPrompt(tenantId),
  ]);

  // Adapt the voice-first system prompt for WhatsApp text mode
  const waSystemPrompt = `${systemPrompt}\n\n═══════════════════════════════════════════\nCHANNEL: WHATSAPP TEXT\n═══════════════════════════════════════════\nYou are replying via WhatsApp (text messages), not voice. Adapt:\n- Keep replies SHORT — 1-3 lines per message ideal.\n- Use emojis sparingly (1-2 per message max).\n- Use line breaks for clarity, NOT WhatsApp markdown (*bold* / _italic_ get eaten by API).\n- The customer's phone is already known: ${customerPhone}. Don't re-ask. Use it directly when calling tools that need phone.\n- If you'd say "let me check that for you" before a tool call in voice, DON'T — just call the tool. WhatsApp users don't need filler.\n- Don't read out long menus — summarize, then ask "want details on any of these?"\n- For PDPA: no recording disclosure needed on text channel — they have the chat record.`;

  // Append the new user message
  const userMsg: ConvMessage = {
    role: "user",
    text: msg.text,
    at: new Date().toISOString(),
  };
  await appendMessage(customerPhone, userMsg, msg.customerName ?? undefined, tenantId);

  // Tool-call loop (Gemini may need multiple rounds to satisfy the user)
  const contents = toGeminiContents([...history, userMsg]);
  let finalText: string | null = null;
  let lastMutation: ToolOutcome | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await callGemini({
      systemPrompt: waSystemPrompt,
      tools: [...TOOL_DECLARATIONS],
      contents,
    });

    if (result.functionCall) {
      // Execute tool, append both the call and the response to context
      const toolResult = await executeTool(
        result.functionCall.name,
        result.functionCall.args,
        sessionId,
        tenantId,
      );

      // Remember the last booking-mutating tool outcome so that if the loop exits
      // before the model speaks, we can still CONFIRM a success (never report failure).
      if (isMutatingTool(result.functionCall.name)) {
        lastMutation = { name: result.functionCall.name, result: toolResult };
      }

      contents.push({
        role: "model",
        parts: [{ functionCall: result.functionCall }],
      });
      contents.push({
        role: "function",
        parts: [
          {
            functionResponse: {
              name: result.functionCall.name,
              response: toolResult,
            },
          },
        ],
      });

      // Persist both turns
      await appendMessage(customerPhone, {
        role: "model",
        functionCall: result.functionCall,
        at: new Date().toISOString(),
      }, undefined, tenantId);
      await appendMessage(customerPhone, {
        role: "function",
        functionResponse: { name: result.functionCall.name, response: toolResult },
        at: new Date().toISOString(),
      }, undefined, tenantId);
      continue;
    }

    finalText = result.text ?? "I'm sorry, I didn't catch that. Could you rephrase?";
    break;
  }

  // Loop exhausted without the model producing text. If a booking-mutating tool just
  // succeeded, CONFIRM it (the tool's own message) — never tell the customer it failed.
  if (!finalText) {
    finalText = resolveFinalReply(null, lastMutation);
  }

  // Send via Meta Cloud API. Report success ONLY after the reply is actually DELIVERED.
  // A transient send failure returns retryable so the batch leaves the message
  // unprocessed (stashing pendingReply) instead of silently consuming it — the booking
  // may already be committed, so the customer MUST eventually be told.
  try {
    await sendText(customerPhone, finalText);
  } catch (err) {
    log.warn({ event: "wa_reply_send_failed_will_retry", phone: customerPhone, err, tenantId });
    return { ok: false, retryable: true, replyText: finalText, error: "send_failed" };
  }
  await appendMessage(customerPhone, {
    role: "model",
    text: finalText,
    at: new Date().toISOString(),
  }, undefined, tenantId);

  return { ok: true, replyText: finalText };
}

// Batch-process all unprocessed inbound messages (cron entry point)
export async function processInboundBatch(
  limit = 20,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<{
  processed: number;
  failed: number;
  skipped: number;
}> {
  const db = getDb();
  const snap = await db
    .collection(tc(tenantId, "inbound_messages"))
    .where("processed", "==", false)
    .orderBy("receivedAt", "asc")
    .limit(limit)
    .get();

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    // Atomically CLAIM the message so the cron + webhook trigger can't both
    // reply to it. Re-read inside the transaction; only proceed if it's still
    // unprocessed AND not already claimed by a live run (stale claims older
    // than STALE_CLAIM_MS are recoverable). If the claim fails, a concurrent
    // run owns it — skip silently without counting it.
    const nowIso = new Date().toISOString();
    let claimed = false;
    try {
      await db.runTransaction(async (txn) => {
        const fresh = await txn.get(doc.ref);
        if (!fresh.exists) return;
        const data = fresh.data() as InboundMessage;
        if (data.processed === true) return;

        const claimedAtMs = data.claimedAt ? Date.parse(data.claimedAt) : NaN;
        const isStaleClaim =
          Number.isFinite(claimedAtMs) &&
          Date.now() - claimedAtMs > STALE_CLAIM_MS;
        if (data.processing && !isStaleClaim) return;

        txn.update(doc.ref, { processing: true, claimedAt: nowIso });
        claimed = true;
      });
    } catch (err) {
      // Transaction contention/abort — treat as "not claimed", let the owner run it.
      log.error({
        event: "wa_dispatch_claim_txn_aborted",
        msgId: doc.id,
        err,
        tenantId,
      });
      continue;
    }

    if (!claimed) continue;

    const msg = doc.data() as InboundMessage;
    try {
      const result = await processInboundMessage(msg, tenantId);
      if (result.retryable) {
        // Transient DELIVERY failure — do NOT consume the message. Stash the computed
        // reply and release the claim so a later run re-sends it via the idempotent
        // fast-path (no re-run of the model, no re-booking).
        failed++;
        await doc.ref.update({
          processing: false,
          pendingReply: result.replyText ?? null,
          processingError: result.error ?? "send_failed",
        });
      } else if (!result.ok) {
        failed++;
        await doc.ref.update({ processed: true, processing: false, processingError: result.error ?? "unknown" });
      } else if (result.replyText) {
        processed++;
        await doc.ref.update({ processed: true, processing: false, pendingReply: null });
      } else {
        skipped++;
        await doc.ref.update({ processed: true, processing: false });
      }
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      log.error({
        event: "wa_dispatch_msg_failed",
        msgId: doc.id,
        err,
        tenantId,
      });
      await doc.ref.update({
        processed: true,
        processing: false,
        processingError: message.slice(0, 500),
      });
    }
  }

  return { processed, failed, skipped };
}
