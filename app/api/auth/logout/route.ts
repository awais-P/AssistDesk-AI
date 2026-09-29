import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, clearCurrentSession, sessionCookieOptions } from "@/src/lib/auth";

export async function POST() {
  await clearCurrentSession();
  const response = NextResponse.json({ success: true });

  response.cookies.set(AUTH_COOKIE_NAME, "", {
    ...sessionCookieOptions(new Date(0)),
    maxAge: 0,
  });

  return response;
}
