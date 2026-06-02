import { NextResponse } from "next/server";
import { findReservationsByPhone } from "@/lib/reservations/lifecycle";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveTenantId } from "@/lib/tenants/resolver";
import { resolveDate } from "@/lib/reservations/date-resolver";

// GET /api/reservations/find?phone=01154302561&date=2026-04-25&activeOnly=true
// Rate-limited: 20 lookups/hour per IP. Each lookup is by an exact phone — attackers
// can still try but can't bulk-enumerate Malaysian numbers.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const phone = searchParams.get("phone");
  const rawDate = searchParams.get("date") ?? undefined;
  // Resolve the optional date filter to canonical YYYY-MM-DD so "Saturday"
  // matches a stored "2026-04-25". If unparseable, IGNORE the filter (return
  // all of the phone's reservations) rather than erroring — find is read-only.
  const resolvedDate = rawDate ? resolveDate(rawDate) : undefined;
  const date = resolvedDate?.ok ? resolvedDate.date : undefined;
  const activeOnly = searchParams.get("activeOnly") !== "false";

  if (!phone || phone.trim().length < 5) {
    return NextResponse.json(
      { success: false, error: "Missing or too-short 'phone' parameter" },
      { status: 400 },
    );
  }

  // Rate limit per IP
  const ip = getClientIp(request);
  const ipLimit = await rateLimit(`res-find-ip:${ip}`, { limit: 30, windowSeconds: 3600 });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many lookups. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.resetInSeconds) } },
    );
  }

  // Additional rate limit per phone (prevents bulk enumeration from rotating IPs)
  const phoneLimit = await rateLimit(`res-find-phone:${phone.replace(/\D/g, "")}`, {
    limit: 10,
    windowSeconds: 3600,
  });
  if (!phoneLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many lookups for this number." },
      { status: 429 },
    );
  }

  try {
    const reservations = await findReservationsByPhone({
      phone,
      ...(date && { date }),
      activeOnly,
      tenantId: resolveTenantId(request),
    });

    return NextResponse.json({
      success: true,
      data: reservations.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        date: r.date,
        time: r.time,
        pax: r.pax,
        menu_choice: r.menuChoice,
        remarks: r.remarks,
        status: r.status ?? "confirmed",
        created_at: r.createdAt,
      })),
      count: reservations.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[reservations/find] failed:", msg);
    return NextResponse.json(
      { success: false, error: msg.slice(0, 200) },
      { status: 500 },
    );
  }
}
