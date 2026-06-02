import { NextResponse } from "next/server";
import { searchMenu } from "@/lib/menu/firestore";
import { resolveTenantId } from "@/lib/tenants/resolver";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");

  if (!query || query.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: "Missing query parameter 'q'" },
      { status: 400 },
    );
  }

  try {
    const tenantId = resolveTenantId(request);
    const results = await searchMenu(query, tenantId);
    return NextResponse.json({
      success: true,
      data: results.map((item) => ({
        id: item.id,
        name: item.names.en,
        name_zh: item.names.zh,
        name_ko: item.names.ko,
        price_rm: item.priceRm,
        category: item.category,
        portion: item.portionDescription,
        description: item.description.en,
        allergens: item.allergens,
        spice_level: item.spiceLevel,
        is_signature: item.isSignature,
        is_popular: item.isPopular,
        tags: item.tags,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[menu/search] failed:", message);
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
