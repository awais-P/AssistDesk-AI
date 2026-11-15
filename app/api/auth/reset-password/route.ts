import { NextResponse } from "next/server";
import { resetPasswordWithToken } from "@/src/lib/auth";
import {
  RATE_LIMITS,
  consumeRateLimit,
  getRequestIp,
  hashClientIp,
  tooManyRequests,
} from "@/src/lib/rate-limit";

type ResetPasswordPayload = {
  token?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  const limit = await consumeRateLimit(
    `reset-pw-ip:${hashClientIp(getRequestIp(request))}`,
    RATE_LIMITS.signupPerIp,
  );

  if (!limit.allowed) {
    return tooManyRequests(limit, "Too many requests. Please try again later.");
  }

  const body = (await request.json().catch(() => ({}))) as ResetPasswordPayload;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!token) {
    return NextResponse.json(
      { error: "Password reset token is required." },
      { status: 400 },
    );
  }

  if (!password) {
    return NextResponse.json(
      { error: "Please enter a new password." },
      { status: 400 },
    );
  }

  const result = await resetPasswordWithToken(token, password);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, expired: result.expired },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    message: "Your password has been reset successfully. You can now log in with your new password.",
  });
}
