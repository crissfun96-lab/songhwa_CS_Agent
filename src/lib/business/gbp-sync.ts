// Google Places API (New) integration — pulls Songhwa's business profile.
// Docs: https://developers.google.com/maps/documentation/places/web-service/place-details
//
// Setup:
// 1. Enable "Places API (New)" in Google Cloud Console for the Firebase project
// 2. Create API key restricted to Places API
// 3. Find the Place ID once (see findPlaceId below)
// 4. Set env vars:
//    GOOGLE_PLACES_API_KEY=...
//    SONGHWA_PLACE_ID=ChIJ...
//
// Cost: first 5,000 requests/month FREE. At 1/day = completely free tier.

import type { BusinessInfo, DailyHours } from "./types";

const PLACES_BASE = "https://places.googleapis.com/v1";

// Fields we want from Places API — minimizes cost (billed by field mask tier)
const FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "regularOpeningHours",
  "rating",
  "userRatingCount",
  "types",
  "priceLevel",
  "googleMapsUri",
  "photos",
].join(",");

// ── Place Details (the main call) ─────────────────────────────
interface PlacesOpeningPeriod {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}

interface PlacesRegularHours {
  periods?: PlacesOpeningPeriod[];
  weekdayDescriptions?: string[];
}

interface PlacesPhoto {
  name: string;
  widthPx?: number;
  heightPx?: number;
}

interface PlaceDetailsResponse {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  regularOpeningHours?: PlacesRegularHours;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  priceLevel?: string; // "PRICE_LEVEL_MODERATE" etc.
  googleMapsUri?: string;
  photos?: PlacesPhoto[];
}

export async function fetchPlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<BusinessInfo> {
  const url = `${PLACES_BASE}/places/${encodeURIComponent(placeId)}`;
  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as PlaceDetailsResponse;

  const photoUrls = await resolvePhotoUrls(data.photos ?? [], apiKey, 5);

  return {
    placeId: data.id,
    name: data.displayName?.text ?? "Songhwa Korean Cuisine",
    address: data.formattedAddress ?? "",
    phone: data.nationalPhoneNumber ?? data.internationalPhoneNumber ?? "",
    hours: parseHours(data.regularOpeningHours),
    weekdayDescriptions: data.regularOpeningHours?.weekdayDescriptions ?? [],
    rating: data.rating ?? 0,
    reviewCount: data.userRatingCount ?? 0,
    categories: data.types ?? [],
    priceLevel: parsePriceLevel(data.priceLevel),
    mapsUrl: data.googleMapsUri ?? "",
    photoUrls,
    fetchedAt: new Date().toISOString(),
    source: "google_places_api",
  };
}

// Resolve photo references to actual URLs (one extra call per photo)
async function resolvePhotoUrls(
  photos: PlacesPhoto[],
  apiKey: string,
  limit: number,
): Promise<string[]> {
  const subset = photos.slice(0, limit);
  const urls = await Promise.all(
    subset.map(async (p) => {
      try {
        const url = `${PLACES_BASE}/${p.name}/media?maxWidthPx=1024&skipHttpRedirect=true&key=${apiKey}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return null;
        const data = (await res.json()) as { photoUri?: string };
        return data.photoUri ?? null;
      } catch {
        return null;
      }
    }),
  );
  return urls.filter((u): u is string => u !== null);
}

function parseHours(hours?: PlacesRegularHours): DailyHours[] {
  const week: DailyHours[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    isClosed: true,
    periods: [],
  }));

  if (!hours?.periods) return week;

  for (const period of hours.periods) {
    const day = period.open.day;
    if (day < 0 || day > 6) continue;
    week[day].isClosed = false;
    week[day].periods.push({
      openHhmm: formatHhmm(period.open.hour, period.open.minute),
      closeHhmm: period.close
        ? formatHhmm(period.close.hour, period.close.minute)
        : "23:59",
    });
  }

  return week;
}

function formatHhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parsePriceLevel(level?: string): number | null {
  switch (level) {
    case "PRICE_LEVEL_FREE": return 0;
    case "PRICE_LEVEL_INEXPENSIVE": return 1;
    case "PRICE_LEVEL_MODERATE": return 2;
    case "PRICE_LEVEL_EXPENSIVE": return 3;
    case "PRICE_LEVEL_VERY_EXPENSIVE": return 4;
    default: return null;
  }
}

// ── One-time helper: find Place ID from text query ────────────
// Used once during setup. Not called on every sync.
export async function findPlaceId(
  textQuery: string,
  apiKey: string,
): Promise<{ placeId: string; name: string; address: string } | null> {
  const url = `${PLACES_BASE}/places:searchText`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery, maxResultCount: 1 }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places searchText ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    places?: Array<{
      id: string;
      displayName?: { text: string };
      formattedAddress?: string;
    }>;
  };

  const first = data.places?.[0];
  if (!first) return null;

  return {
    placeId: first.id,
    name: first.displayName?.text ?? "",
    address: first.formattedAddress ?? "",
  };
}
