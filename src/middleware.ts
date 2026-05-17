import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Basic HTTP Auth for /admin/* and /api/admin/* routes.

// Constant-time string comparison — prevents timing attacks on credentials.
// Works on Edge runtime (no Node crypto required — uses Web Crypto concept).
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isAdmin = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  if (!isAdmin) return NextResponse.next();

  const adminUser = process.env.ADMIN_USERNAME;
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!adminUser || !adminPass) {
    return new NextResponse(
      "Admin disabled. Set ADMIN_USERNAME and ADMIN_PASSWORD env vars.",
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Basic ")) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Songhwa Admin", charset="UTF-8"',
      },
    });
  }

  try {
    const encoded = auth.slice(6);
    const decoded = atob(encoded);
    const idx = decoded.indexOf(":");
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);

    // Constant-time comparison blocks timing-based password attacks
    const userOk = constantTimeEqual(user, adminUser);
    const passOk = constantTimeEqual(pass, adminPass);
    if (!userOk || !passOk) {
      return new NextResponse("Invalid credentials", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Songhwa Admin", charset="UTF-8"',
        },
      });
    }
  } catch {
    return new NextResponse("Invalid auth header", { status: 400 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
