import { NextResponse } from "next/server";

/**
 * POST /api/songhwa-token
 * Generates a short-lived ephemeral token for the Gemini Live API.
 * Keeps the real API key server-side only.
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Ephemeral token error:", errorText);
      return NextResponse.json(
        { error: "Ephemeral token generation failed" },
        { status: 502 },
      );
    }

    const data = await response.json();
    return NextResponse.json({ token: data.name });
  } catch (error) {
    console.error("Token generation failed:", error);
    return NextResponse.json(
      { error: "Token generation failed" },
      { status: 500 },
    );
  }
}
