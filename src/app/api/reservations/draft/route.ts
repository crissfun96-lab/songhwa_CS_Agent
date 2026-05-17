import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { upsertDraft } from "@/lib/reservations/intent";

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

    const draft = await upsertDraft(parsed.sessionId, {
      name: parsed.name ?? null,
      phone: parsed.phone ?? null,
      date: parsed.date ?? null,
      time: parsed.time ?? null,
      pax: parsed.pax ?? null,
      menuChoice: parsed.menuChoice ?? null,
      remarks: parsed.remarks ?? null,
    });

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
    console.error("[draft] failed:", message);
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
