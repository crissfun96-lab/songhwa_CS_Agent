import { NextResponse } from "next/server";
import {
  buildSystemPrompt,
  TOOL_DECLARATIONS,
} from "@/lib/menu/prompt-injector";
import { resolveTenantId } from "@/lib/tenants/resolver";

// Called by the client on session start.
// Returns: { systemPrompt, tools } — everything the agent needs to configure itself.
// Kept server-side so we can update menu/prompt without redeploying the client.

export async function GET(request: Request) {
  try {
    const systemPrompt = await buildSystemPrompt(resolveTenantId(request));

    return NextResponse.json({
      success: true,
      data: {
        systemPrompt,
        tools: TOOL_DECLARATIONS,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[menu/config] failed:", message);
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
