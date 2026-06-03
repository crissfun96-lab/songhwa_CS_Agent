import { NextResponse } from "next/server";
import { getDishById } from "@/lib/menu/firestore";
import { resolveTenantId } from "@/lib/tenants/resolver";
import { log } from "@/lib/logger";

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
    const tenantId = resolveTenantId(request);
    const result = await getDishById(id, tenantId);

    if (result.kind === "none") {
      return NextResponse.json(
        { success: false, error: `No dish found with id '${id}'` },
        { status: 404 },
      );
    }

    if (result.kind === "set") {
      return NextResponse.json({
        success: true,
        data: {
          id,
          name: result.data.name,
          kind: "set",
          allergens: [],
          note: "Set meals contain multiple dishes — ask customer which component they're asking about. Use get_dish_details on each included dish for allergen info.",
        },
      });
    }

    const item = result.data;
    return NextResponse.json({
      success: true,
      data: {
        id: item.id,
        name: item.names.en,
        kind: "dish",
        allergens: item.allergens,
        spice_level: item.spiceLevel,
        note:
          item.allergens.length === 0
            ? "No allergens listed. If customer has specific concern, suggest checking with kitchen."
            : `Contains: ${item.allergens.join(", ")}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ event: "menu_allergens_failed", err: error });
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
