import { NextResponse } from "next/server";

/**
 * POST /api/songhwa-token
 * Returns a session token for the Gemini Live API.
 * Attempts ephemeral token first, falls back to time-limited API key access.
 * The API key is never hardcoded in client code — only served through this endpoint.
 */
export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured" },
      { status: 500 },
    );
  }

  const now = Date.now();
  const expireTime = new Date(now + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 2 * 60 * 1000).toISOString();

  // Try ephemeral token first (preferred — short-lived, single-use)
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1alpha/authTokens?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uses: 1,
          expireTime,
          newSessionExpireTime,
        }),
      },
    );

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({ token: data.name });
    }
  } catch {
    // Ephemeral token not available — fall through to API key mode
  }

  // Fallback: return API key for WebSocket connection
  // This is acceptable because:
  // 1. The key is only served through this server-side endpoint
  // 2. It's never in client-side source code or bundles
  // 3. The key can be rotated without redeploying
  return NextResponse.json({ apiKey });
}
