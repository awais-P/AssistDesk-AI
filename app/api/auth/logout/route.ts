import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, clearCurrentSession } from "@/src/lib/auth";

export async function POST() {
  await clearCurrentSession();
  const response = NextResponse.json({ success: true });

  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
