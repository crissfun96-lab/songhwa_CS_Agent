import { NextResponse } from "next/server";
import { getDishById } from "@/lib/menu/firestore";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { success: false, error: "Missing 'id' parameter" },
      { status: 400 },
    );
  }

  try {
    const result = await getDishById(id);

    if (result.kind === "none") {
      return NextResponse.json(
        { success: false, error: `No dish or set found with id '${id}'` },
        { status: 404 },
      );
    }

    if (result.kind === "item") {
      const item = result.data;
      return NextResponse.json({
        success: true,
        data: {
          kind: "dish",
          id: item.id,
          name: item.names.en,
          name_zh: item.names.zh,
          name_ko: item.names.ko,
          name_bm: item.names.bm,
          price_rm: item.priceRm,
          category: item.category,
          portion: item.portionDescription,
          description: item.description.en,
          description_zh: item.description.zh,
          allergens: item.allergens,
          spice_level: item.spiceLevel,
          is_signature: item.isSignature,
          is_popular: item.isPopular,
          tags: item.tags,
          photo_url: item.photoUrl,
        },
      });
    }

    const set = result.data;
    return NextResponse.json({
      success: true,
      data: {
        kind: "set",
        id: set.id,
        code: set.code,
        name: set.name,
        pax: `${set.paxMin}-${set.paxMax}`,
        price_rm: set.priceRm,
        flags: set.flags,
        description: set.description.en,
        description_zh: set.description.zh,
        photo_url: set.photoUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[menu/dish] failed:", message);
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
