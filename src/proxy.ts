import { NextResponse, type NextRequest } from "next/server";
import { getIronSession, type SessionOptions } from "iron-session";
import type { SessionData } from "@/lib/auth";

// Mirror auth.ts so we can read the cookie in the edge proxy without
// pulling in the prisma client. Keep names in sync.
const sessionOptions: SessionOptions = {
  password:
    process.env.SESSION_SECRET ||
    "dev-only-fallback-secret-please-replace-32chars",
  cookieName: "scraper_1688_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
  },
};

const PUBLIC_PATHS = ["/login", "/signup"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname === "/api/jobs/process") return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  // Common static asset extensions
  if (/\.(svg|png|jpe?g|gif|ico|webp|css|js|map|woff2?)$/i.test(pathname)) {
    return true;
  }
  return false;
}

function isLocalhostHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Localhost dev convenience — skip the gate.
  const host = req.headers.get("host");
  if (isLocalhostHost(host)) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  if (!session.userId) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  // Match everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
