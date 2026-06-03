import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createComplaint } from "@/lib/complaints/firestore";
import { sendComplaintNotification } from "@/lib/telegram";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveTenantId } from "@/lib/tenants/resolver";
import { log } from "@/lib/logger";

function sanitize(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[*_~`]/g, "").slice(0, 2000).trim();
}

const CreateComplaintSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(5).max(30),
  category: z.enum([
    "food_quality",
    "service",
    "wait_time",
    "billing",
    "cleanliness",
    "other",
  ]),
  description: z.string().min(5).max(2000),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  visit_date: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = CreateComplaintSchema.parse(body);

    // Rate limit: prevent spam/DoS attacks on complaint endpoint
    const ip = getClientIp(request);
    const ipOk = await rateLimit(`complaint-ip:${ip}`, { limit: 10, windowSeconds: 3600 });
    const phoneOk = await rateLimit(`complaint-phone:${parsed.phone.replace(/\D/g, "")}`, {
      limit: 3,
      windowSeconds: 3600,
    });
    if (!ipOk.allowed || !phoneOk.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many complaints from this source. Please call us directly." },
        { status: 429 },
      );
    }

    const complaint = await createComplaint({
      name: sanitize(parsed.name),
      phone: parsed.phone,
      category: parsed.category,
      description: sanitize(parsed.description),
      severity: parsed.severity,
      visitDate: parsed.visit_date,
      tenantId: resolveTenantId(request),
    });

    // Fire-and-forget Telegram alert (never blocks response)
    sendComplaintNotification(complaint).catch((err) =>
      log.error({ event: "telegram_complaint_notification_failed", err }),
    );

    return NextResponse.json({
      success: true,
      data: {
        ticket_id: complaint.ticketId,
        severity: complaint.severity,
        response_eta: complaint.severity === "critical"
          ? "Within 1 hour — manager will call you personally"
          : complaint.severity === "high"
            ? "Within 4 hours"
            : "Within 24 hours",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid complaint data", details: error.issues },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    log.error({ event: "complaint_post_error", err: error });
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
