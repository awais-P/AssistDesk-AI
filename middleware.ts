import { NextResponse, type NextRequest } from "next/server";

/**
 * Cross-site request check for the dashboard API (SEC-14, defence in depth next to the
 * SameSite=Lax session cookie). A browser always sends `Origin` on POST/PUT/PATCH/DELETE;
 * when such a request carries the dashboard session cookie but comes from another site,
 * it is refused. Requests without the cookie (widget, public API with keys, provider
 * webhooks) are authenticated in their own ways and are not affected.
 *
 * Kept free of imports from src/lib: middleware runs in the edge runtime.
 */

const SESSION_COOKIE = "assistdesk_session";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hostOf(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  if (!UNSAFE_METHODS.has(request.method) || !request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const origin = request.headers.get("origin");

  // Non-browser clients send no Origin; a browser would have sent one.
  if (!origin) {
    return NextResponse.next();
  }

  const originHost = hostOf(origin);
  const allowed = new Set(
    [
      request.headers.get("x-forwarded-host"),
      request.headers.get("host"),
      request.nextUrl.host,
      hostOf(process.env.NEXT_PUBLIC_APP_URL),
    ]
      .filter((host): host is string => Boolean(host))
      .map((host) => host.split(",")[0].trim().toLowerCase()),
  );

  if (originHost && allowed.has(originHost)) {
    return NextResponse.next();
  }

  return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
}

export const config = {
  matcher: "/api/:path*",
};
