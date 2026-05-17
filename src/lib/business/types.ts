// Business info (hours, address, phone, ratings) — sourced from Google Business Profile
// via Places API (New). Separate from menu data because it updates independently
// and comes from a different source of truth.

export interface DailyHours {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday
  isClosed: boolean;
  periods: Array<{
    openHhmm: string;  // "11:30"
    closeHhmm: string; // "15:00"
  }>;
}

export interface BusinessInfo {
  placeId: string;
  name: string;
  address: string;
  phone: string;
  hours: DailyHours[];           // always 7 entries, ordered Sun→Sat
  weekdayDescriptions: string[]; // human-readable per-day summary
  rating: number;                // 0–5
  reviewCount: number;
  categories: string[];
  priceLevel: number | null;     // 1–4
  mapsUrl: string;
  photoUrls: string[];           // first 5 photos
  fetchedAt: string;             // ISO 8601
  source: "google_places_api";
}

export interface BusinessInfoSyncResult {
  success: boolean;
  info?: BusinessInfo;
  error?: string;
  durationMs: number;
}
