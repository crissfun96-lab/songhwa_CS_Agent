import { NextResponse } from "next/server";
import { lookupCustomerByName } from "@/lib/customers";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

// Rate-limited customer lookup.
// Returns partial info (no full phone number, no full order history) to limit PII exposure
// while still supporting the agent's "are you a returning customer?" flow.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");

  if (!name || name.trim().length < 2) {
    return NextResponse.json(
      { success: false, error: "Missing 'name' parameter (minimum 2 characters)" },
      { status: 400 },
    );
  }

  // Rate limit — prevent enumeration of customer database
  const ip = getClientIp(request);
  const ipLimit = await rateLimit(`customers-ip:${ip}`, { limit: 50, windowSeconds: 3600 });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many lookups." },
      { status: 429, headers: { "Retry-After": String(ipLimit.resetInSeconds) } },
    );
  }

  // Per-query limit (attacker with name dictionary gets throttled)
  const queryLimit = await rateLimit(
    `customers-query:${name.toLowerCase().replace(/\s/g, "_").slice(0, 40)}`,
    { limit: 10, windowSeconds: 3600 },
  );
  if (!queryLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many lookups for this name." },
      { status: 429 },
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

      // Mask phone number — don't return raw PII. Agent can still greet with name + last visit.
      const maskedPhone = customer.phone
        ? customer.phone.replace(/(\d{3,4})\d+(\d{3,4})/, "$1***$2")
        : "";

      return NextResponse.json({
        success: true,
        data: {
          found: true,
          name: customer.name,
          phoneMasked: maskedPhone,  // e.g., "0115***2561" — not full PII
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
