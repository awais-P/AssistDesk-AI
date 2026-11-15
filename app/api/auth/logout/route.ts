import { NextResponse } from "next/server";
import { auditUser } from "@/src/lib/audit";
import { AUTH_COOKIE_NAME, clearCurrentSession, getCurrentSession, sessionCookieOptions } from "@/src/lib/auth";

export async function POST(request: Request) {
  const current = await getCurrentSession();

  if (current) {
    await auditUser(current.user, { action: "auth.logout", category: "auth", summary: `${current.user.fullName} signed out`, request });
  }

  await clearCurrentSession();
  const response = NextResponse.json({ success: true });

  response.cookies.set(AUTH_COOKIE_NAME, "", {
    ...sessionCookieOptions(new Date(0)),
    maxAge: 0,
  });

  return response;
}
