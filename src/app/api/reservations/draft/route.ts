import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { log } from "@/lib/logger";
import { upsertDraft } from "@/lib/reservations/intent";
import { resolveTenantId } from "@/lib/tenants/resolver";
import { resolveDate } from "@/lib/reservations/date-resolver";

// Intent capture — agent calls this every time it has new info (name, date, etc)
// If the customer hangs up mid-booking, staff still has the draft.

const DraftSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().nullish(),
  phone: z.string().nullish(),
  date: z.string().nullish(),
  time: z.string().nullish(),
  pax: z.number().int().nullish(),
  menuChoice: z.string().nullish(),
  remarks: z.string().nullish(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = DraftSchema.parse(body);

    // Best-effort date canonicalization — drafts may be partial, so if the date
    // is present but unparseable we keep the raw value rather than dropping it
    // (staff can still read "next Saturday" in the draft and follow up).
    const draftDate = parsed.date
      ? (() => {
          const r = resolveDate(parsed.date);
          return r.ok ? r.date : parsed.date;
        })()
      : null;

    const draft = await upsertDraft(
      parsed.sessionId,
      {
        name: parsed.name ?? null,
        phone: parsed.phone ?? null,
        date: draftDate,
        time: parsed.time ?? null,
        pax: parsed.pax ?? null,
        menuChoice: parsed.menuChoice ?? null,
        remarks: parsed.remarks ?? null,
      },
      resolveTenantId(request),
    );

    return NextResponse.json({
      success: true,
      data: {
        draft_id: draft.id,
        completeness: draft.completeness,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid draft data" },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    log.error({ event: "draft_post_error", err: error });
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
