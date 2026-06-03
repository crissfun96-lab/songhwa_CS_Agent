import { NextResponse } from "next/server";
import {
  getBusinessInfo,
  computeCurrentStatus,
  todayHoursText,
} from "@/lib/business/firestore";
import { resolveTenantId } from "@/lib/tenants/resolver";
import { log } from "@/lib/logger";
import type { BusinessInfo } from "@/lib/business/types";

// Tool endpoint for get_business_status — returns right-now open/closed info.

// Songhwa is open 365 days/year, lunch 11:30-15:00 + dinner 17:30-22:00.
// Hardcoded fallback used when Google Places sync hasn't run yet (or isn't configured).
const HARDCODED_HOURS: BusinessInfo = {
  placeId: "hardcoded",
  name: "Songhwa Korean Cuisine",
  address: "Level 8, Millerz Square, 357 Jalan Klang Lama, Kuala Lumpur",
  phone: "+60 11-5430 2561",
  hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    dayOfWeek: day as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    isClosed: false,
    periods: [
      { openHhmm: "11:30", closeHhmm: "15:00" },
      { openHhmm: "17:30", closeHhmm: "22:00" },
    ],
  })),
  weekdayDescriptions: [
    "Sunday: 11:30 AM – 3:00 PM, 5:30 PM – 10:00 PM",
    "Monday: 11:30 AM – 3:00 PM, 5:30 PM – 10:00 PM",
    "Tuesday: 11:30 AM – 3:00 PM, 5:30 PM – 10:00 PM",
    "Wednesday: 11:30 AM – 3:00 PM, 5:30 PM – 10:00 PM",
    "Thursday: 11:30 AM – 3:00 PM, 5:30 PM – 10:00 PM",
    "Friday: 11:30 AM – 3:00 PM, 5:30 PM – 10:00 PM",
    "Saturday: 11:30 AM – 3:00 PM, 5:30 PM – 10:00 PM",
  ],
  rating: 0,
  reviewCount: 0,
  categories: ["Korean Restaurant"],
  priceLevel: null,
  mapsUrl: "",
  photoUrls: [],
  fetchedAt: new Date().toISOString(),
  source: "google_places_api",
};

export async function GET(request: Request) {
  try {
    const info = (await getBusinessInfo(resolveTenantId(request))) ?? HARDCODED_HOURS;

    const status = computeCurrentStatus(info);
    const todayName = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kuala_Lumpur",
      weekday: "long",
    }).format(new Date());

    return NextResponse.json({
      success: true,
      data: {
        is_open: status.isOpen,
        status_text: status.statusText,
        today: todayName,
        today_hours: todayHoursText(info),
        full_week: info.weekdayDescriptions,
        rating: info.rating,
        review_count: info.reviewCount,
        phone: info.phone,
        address: info.address,
        maps_url: info.mapsUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ event: "business_status_error", err: error });
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
