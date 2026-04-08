import { NextResponse } from "next/server";
import { lookupCustomerByName } from "@/lib/customers";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");

  if (!name || name.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: "Missing 'name' query parameter" },
      { status: 400 },
    );
  }

  try {
    const customer = await lookupCustomerByName(name);

    if (customer) {
      const recentOrders = customer.favoriteOrders.slice(-3).join(", ") || "none recorded";
      const lastReservation = customer.reservations[customer.reservations.length - 1];
      const lastVisitInfo = lastReservation
        ? `Last visit: ${lastReservation.date}, ${lastReservation.pax} pax, ordered ${lastReservation.menuChoice || "not specified"}`
        : "No previous reservation details";

      return NextResponse.json({
        success: true,
        data: {
          found: true,
          name: customer.name,
          phone: customer.phone,
          visitCount: customer.visitCount,
          lastVisit: customer.lastVisit,
          favoriteOrders: recentOrders,
          lastVisitInfo,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        found: false,
        message: `No customer record found for "${name}". This is a new customer.`,
      },
    });
  } catch (error) {
    console.error("[Customers] GET error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to lookup customer" },
      { status: 500 },
    );
  }
}
