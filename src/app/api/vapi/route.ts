// Vapi tool-call handler.
// Vapi POSTs here when the AI invokes any of the 14 functions.
// We route to the same internal logic as the web voice + WhatsApp dispatcher
// so all three channels share the same tool behavior.
//
// Vapi auth: requires X-Vapi-Secret header matching VAPI_SERVER_SECRET env var.
// Multi-tenant: each Vapi assistant runs against a single tenant. Set
// VAPI_TENANT_ID per deployment (or pass through Vapi metadata in future).

import { NextResponse } from "next/server";
import { DEFAULT_TENANT_ID } from "@/lib/tenants/types";
import { verifyBearer, constantTimeStringEqual } from "@/lib/auth-secret";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "https://songhwa-cs-agent.vercel.app";

interface VapiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

interface VapiPayload {
  message?: {
    type: string;
    toolCalls?: VapiToolCall[];
    toolCallList?: VapiToolCall[];
    call?: {
      id?: string;
      customer?: { number?: string };
      assistant?: { metadata?: { tenantId?: string } };
    };
    assistant?: { metadata?: { tenantId?: string } };
  };
}

// Build internal-call headers — forwards tenant context with the shared
// secret so resolveTenantId() honors X-Foxie-Tenant on the receiving end.
function internalHeaders(tenantId: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: APP_BASE_URL,
    "User-Agent": "songhwa-vapi-bridge/1",
    "X-Foxie-Tenant": tenantId,
  };
  const secret = process.env.FOXIE_INTERNAL_SECRET?.trim();
  if (secret) headers["X-Foxie-Internal-Secret"] = secret;
  return headers;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  sessionId: string,
  tenantId: string,
): Promise<unknown> {
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
          ? { saved: true, message: `Booking confirmed for ${args.name}, ${args.pax} pax on ${args.date} at ${args.time}. Staff notified via Telegram and WhatsApp.` }
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
        // Phone channel — Vapi can use the live_transfer_target from response
        const r = await fetch(`${APP_BASE_URL}/api/handoff`, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify({ ...args, channel: "phone", vapiCallId: sessionId }),
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

export async function POST(request: Request) {
  // Vapi server auth — set X-Vapi-Secret in Vapi assistant config.
  // Constant-time compare (was `!==` — leaked secret length via timing).
  const expected = process.env.VAPI_SERVER_SECRET?.trim();
  const provided = request.headers.get("x-vapi-secret");
  if (!expected || !provided || !constantTimeStringEqual(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = (await request.json()) as VapiPayload;
  const calls = payload.message?.toolCallList ?? payload.message?.toolCalls ?? [];
  const sessionId = `vapi_${payload.message?.call?.id ?? Date.now()}`;

  // Tenant resolution priority for Vapi:
  //   1. Assistant metadata.tenantId (configured per Vapi assistant)
  //   2. VAPI_TENANT_ID env var (per-deployment override)
  //   3. DEFAULT_TENANT_ID (songhwa)
  const tenantId =
    payload.message?.assistant?.metadata?.tenantId ??
    payload.message?.call?.assistant?.metadata?.tenantId ??
    process.env.VAPI_TENANT_ID?.trim() ??
    DEFAULT_TENANT_ID;

  // Vapi expects { results: [{ toolCallId, result }] }
  const results = [];
  for (const call of calls) {
    let args: Record<string, unknown> = {};
    try {
      args = typeof call.function.arguments === "string"
        ? JSON.parse(call.function.arguments)
        : (call.function.arguments as Record<string, unknown>);
    } catch {
      args = {};
    }
    const out = await executeTool(call.function.name, args, sessionId, tenantId);
    results.push({
      toolCallId: call.id,
      result: typeof out === "string" ? out : JSON.stringify(out),
    });
  }

  return NextResponse.json({ results });
}

// Suppress unused-import lint warning for verifyBearer (kept for symmetry
// with cron routes — Vapi uses its own X-Vapi-Secret header instead).
void verifyBearer;
