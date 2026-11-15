import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  createSession,
  sessionCookieOptions,
  verifyEmailToken,
} from "@/src/lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim() || "";
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");

  if (!token) {
    if (acceptsHtml) {
      return NextResponse.redirect(new URL("/verify-email?error=missing_token", request.url));
    }
    return NextResponse.json({ error: "Verification token is required." }, { status: 400 });
  }

  const result = await verifyEmailToken(token);

  if (!result.success || !result.user) {
    if (acceptsHtml) {
      const errorParam = result.expired ? "expired_token" : "invalid_token";
      return NextResponse.redirect(new URL(`/verify-email?error=${errorParam}`, request.url));
    }
    return NextResponse.json({ error: result.error, expired: result.expired }, { status: 400 });
  }

  const session = await createSession(result.user.id);
  const response = acceptsHtml
    ? NextResponse.redirect(new URL("/setup", request.url))
    : NextResponse.json({
        success: true,
        redirectTo: "/setup",
        message: "Email verified successfully. You can now continue to onboarding.",
      });

  response.cookies.set(AUTH_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));

  return response;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";

  if (!token) {
    return NextResponse.json({ error: "Verification token is required." }, { status: 400 });
  }

  const result = await verifyEmailToken(token);

  if (!result.success || !result.user) {
    return NextResponse.json(
      { error: result.error, expired: result.expired },
      { status: 400 },
    );
  }

  const session = await createSession(result.user.id);
  const response = NextResponse.json({
    success: true,
    redirectTo: "/setup",
    message: "Email verified successfully. You can now continue to onboarding.",
  });

  response.cookies.set(AUTH_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));

  return response;
}
