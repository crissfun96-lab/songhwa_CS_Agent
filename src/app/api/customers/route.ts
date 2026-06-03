import { NextResponse } from "next/server";
import { lookupCustomerByPhone, lookupCustomerByName } from "@/lib/customers";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveTenantId } from "@/lib/tenants/resolver";
import { log } from "@/lib/logger";

// Rate-limited customer lookup.
// PREFERRED: ?phone=01154302561 — phone is the canonical identifier.
// LEGACY: ?name=Chris — still supported for backwards compat (deprecated 2026-05-17).
// Returns partial info (masked phone, no full order history) to limit PII exposure.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const phone = searchParams.get("phone");
  const name = searchParams.get("name");

  const lookupKey = phone?.trim() ?? name?.trim() ?? "";
  const lookupType = phone ? "phone" : "name";

  if (!lookupKey || lookupKey.length < 2) {
    return NextResponse.json(
      { success: false, error: "Missing 'phone' (preferred) or 'name' parameter" },
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

  // Per-key limit (attacker dictionary attack throttled)
  const queryLimit = await rateLimit(
    `customers-${lookupType}:${lookupKey.toLowerCase().replace(/\s/g, "_").slice(0, 40)}`,
    { limit: 10, windowSeconds: 3600 },
  );
  if (!queryLimit.allowed) {
    return NextResponse.json(
      { success: false, error: `Too many lookups for this ${lookupType}.` },
      { status: 429 },
    );
  }

  try {
    const tenantId = resolveTenantId(request);
    const customer = phone
      ? await lookupCustomerByPhone(phone, tenantId)
      : await lookupCustomerByName(lookupKey, tenantId);

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
          phoneMasked: maskedPhone,
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
        message: `No customer record found. This is a new customer.`,
      },
    });
  } catch (error) {
    log.error({ event: "customer_lookup_error", err: error });
    return NextResponse.json(
      { success: false, error: "Failed to lookup customer" },
      { status: 500 },
    );
  }
}
