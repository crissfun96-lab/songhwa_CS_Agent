import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { constantTimeStringEqual } from "@/lib/auth-secret";

// Basic HTTP Auth for /admin/* and /api/admin/* routes.

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

    // Constant-time comparison blocks timing-based password attacks.
    // The shared helper pads lengths so the loop runs `maxLen` iterations
    // regardless of input length — no username-length timing oracle.
    const userOk = constantTimeStringEqual(user, adminUser);
    const passOk = constantTimeStringEqual(pass, adminPass);
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
