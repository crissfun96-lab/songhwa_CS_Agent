#!/bin/bash
# ────────────────────────────────────────────────────────────────
# Bug #6 fix: Sync Google Places business hours into Firestore
# ────────────────────────────────────────────────────────────────
# Run AFTER you have:
#   1. Enabled Places API (New) in Google Cloud Console
#      → https://console.cloud.google.com/apis/library/places.googleapis.com
#   2. Created an API key restricted to Places API (New)
#      → https://console.cloud.google.com/apis/credentials
#   3. Added these to Vercel env vars + redeployed:
#      GOOGLE_PLACES_API_KEY   (the key from step 2)
#      CRON_SECRET             (run: openssl rand -hex 32)
#      SONGHWA_PLACE_ID        (leave empty on FIRST run — auto-resolved below)
# ────────────────────────────────────────────────────────────────

set -e

BASE_URL="${BASE_URL:-https://songhwa-cs-agent.vercel.app}"
CRON_SECRET="${CRON_SECRET:-}"

if [ -z "$CRON_SECRET" ]; then
  echo "ERROR: CRON_SECRET env var not set."
  echo "Run: CRON_SECRET=your_secret_here $0"
  exit 1
fi

echo "🦊 Syncing Google Places business profile..."
echo "Target: $BASE_URL/api/business/sync"
echo ""

response=$(curl -sS -X POST "$BASE_URL/api/business/sync" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -w "\nHTTP_STATUS:%{http_code}")

http_status=$(echo "$response" | tail -1 | sed 's/HTTP_STATUS://')
body=$(echo "$response" | sed '$d')

echo "HTTP $http_status"
echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
echo ""

if [ "$http_status" = "200" ]; then
  echo "✅ Sync successful."
  echo ""
  # Extract Place ID if returned in setupMessage
  place_id=$(echo "$body" | grep -oE 'ChIJ[a-zA-Z0-9_-]+' | head -1)
  if [ -n "$place_id" ]; then
    echo "📍 Place ID resolved: $place_id"
    echo ""
    echo "👉 NEXT: add this to Vercel env vars + redeploy:"
    echo "   SONGHWA_PLACE_ID=$place_id"
    echo ""
    echo "Then re-run this script to confirm hours are now populated."
  else
    echo "✅ Place ID already configured. Business hours updated."
    echo ""
    echo "Verify: curl $BASE_URL/api/business/status"
  fi
else
  echo "❌ Sync failed (HTTP $http_status)"
  echo ""
  echo "Common causes:"
  echo "  - CRON_SECRET mismatch with Vercel env var"
  echo "  - GOOGLE_PLACES_API_KEY not set or invalid"
  echo "  - Places API (New) not enabled in GCP"
  echo "  - API key restricted to wrong API or wrong referrer"
  exit 1
fi
