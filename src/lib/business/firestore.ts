import { getDb } from "../firebase-admin";
import { tc } from "../tenants/collection";
import { DEFAULT_TENANT_ID } from "../tenants/types";
import type { BusinessInfo, DailyHours } from "./types";

const DOC_ID = "profile";

export async function saveBusinessInfo(
  info: BusinessInfo,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<void> {
  await getDb().collection(tc(tenantId, "business_info")).doc(DOC_ID).set(info);
}

export async function getBusinessInfo(
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<BusinessInfo | null> {
  const doc = await getDb().collection(tc(tenantId, "business_info")).doc(DOC_ID).get();
  return doc.exists ? (doc.data() as BusinessInfo) : null;
}

// ── Current-status helper (Malaysia time) ─────────────────────
export interface CurrentStatus {
  isOpen: boolean;
  currentPeriod: { openHhmm: string; closeHhmm: string } | null;
  nextOpenDay: number | null;  // 0-6, null if no upcoming
  nextOpenTime: string | null;
  statusText: string;          // human-readable: "Open, closes at 3:00 PM"
}

export function computeCurrentStatus(
  info: BusinessInfo,
  now: Date = new Date(),
): CurrentStatus {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const lookup: Record<string, string> = {};
  for (const part of fmt.formatToParts(now)) {
    lookup[part.type] = part.value;
  }
  const hhmm = `${lookup.hour}:${lookup.minute}`;
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayOfWeek = dayMap[lookup.weekday] ?? 0;

  const today = info.hours.find((h) => h.dayOfWeek === dayOfWeek);
  if (!today || today.isClosed) {
    return {
      isOpen: false,
      currentPeriod: null,
      nextOpenDay: null,
      nextOpenTime: null,
      statusText: "Closed today",
    };
  }

  const openPeriod = today.periods.find(
    (p) => p.openHhmm <= hhmm && hhmm <= p.closeHhmm,
  );

  if (openPeriod) {
    return {
      isOpen: true,
      currentPeriod: openPeriod,
      nextOpenDay: null,
      nextOpenTime: null,
      statusText: `Open now, closes at ${openPeriod.closeHhmm}`,
    };
  }

  const nextToday = today.periods.find((p) => p.openHhmm > hhmm);
  if (nextToday) {
    return {
      isOpen: false,
      currentPeriod: null,
      nextOpenDay: dayOfWeek,
      nextOpenTime: nextToday.openHhmm,
      statusText: `Closed, reopens at ${nextToday.openHhmm} today`,
    };
  }

  return {
    isOpen: false,
    currentPeriod: null,
    nextOpenDay: null,
    nextOpenTime: null,
    statusText: "Closed, opens tomorrow",
  };
}

// ── Serialize hours for prompt injection ──────────────────────
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function hoursToText(hours: DailyHours[]): string {
  return hours
    .map((h) => {
      const name = DAY_NAMES[h.dayOfWeek];
      if (h.isClosed) return `${name}: Closed`;
      const windows = h.periods
        .map((p) => `${p.openHhmm}-${p.closeHhmm}`)
        .join(", ");
      return `${name}: ${windows}`;
    })
    .join("; ");
}
