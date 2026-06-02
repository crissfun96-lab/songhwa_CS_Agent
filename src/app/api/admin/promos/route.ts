import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDb } from "@/lib/firebase-admin";
import { menuCollections } from "@/lib/menu/firestore";
import { buildCompactSummary } from "@/lib/menu/prompt-injector";
import { resolveTenantId } from "@/lib/tenants/resolver";
import type { Promo } from "@/lib/menu/types";

function refreshCache(tenantId: string) {
  buildCompactSummary(tenantId).catch((err) =>
    console.error("[admin] cache rebuild failed:", err),
  );
}

export async function GET(request: Request) {
  try {
    const tenantId = resolveTenantId(request);
    const snapshot = await getDb().collection(menuCollections(tenantId).promos).get();
    const promos = snapshot.docs
      .map((d) => d.data() as Promo)
      .sort((a, b) => a.endDate.localeCompare(b.endDate));
    return NextResponse.json({ success: true, data: promos });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}

const CreateSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  description_en: z.string().default(""),
  discount_type: z.enum(["percent", "fixed_amount", "bogo", "free_item", "set_price"]),
  discount_value: z.number().min(0).default(0),
  applies_to: z.enum(["all", "sets", "a_la_carte", "specific"]).default("all"),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  days_of_week: z.array(z.number()).optional(),
  time_window_start: z.string().optional(),
  time_window_end: z.string().optional(),
  channels: z.array(z.string()).default(["dine_in"]),
  terms: z.string().default(""),
});

export async function POST(request: Request) {
  try {
    const tenantId = resolveTenantId(request);
    const body = await request.json();
    const parsed = CreateSchema.parse(body);

    const now = new Date().toISOString();
    const promo: Promo = {
      id: parsed.id,
      name: parsed.name,
      description: { en: parsed.description_en },
      discountType: parsed.discount_type,
      discountValue: parsed.discount_value,
      appliesTo: parsed.applies_to,
      startDate: parsed.start_date,
      endDate: parsed.end_date,
      ...(parsed.days_of_week && parsed.days_of_week.length > 0 && {
        daysOfWeek: parsed.days_of_week.filter((d): d is 0 | 1 | 2 | 3 | 4 | 5 | 6 =>
          d >= 0 && d <= 6
        ),
      }),
      ...(parsed.time_window_start && parsed.time_window_end && {
        timeWindow: {
          startHhmm: parsed.time_window_start,
          endHhmm: parsed.time_window_end,
        },
      }),
      channels: parsed.channels as Promo["channels"],
      terms: parsed.terms,
      isActive: true,
      sourceVersion: `admin-${Date.now()}`,
      updatedAt: now,
    };

    await getDb()
      .collection(menuCollections(tenantId).promos)
      .doc(promo.id)
      .set(promo);
    refreshCache(tenantId);

    return NextResponse.json({ success: true, data: promo });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid data", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
