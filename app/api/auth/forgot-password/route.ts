import { NextResponse } from "next/server";
import {
  createPasswordResetForUser,
  isValidEmail,
} from "@/src/lib/auth";
import { sendPasswordResetEmail } from "@/src/lib/mailer";
import {
  RATE_LIMITS,
  consumeRateLimit,
  getRequestIp,
  hashClientIp,
  tooManyRequests,
} from "@/src/lib/rate-limit";

type ForgotPasswordPayload = {
  email?: unknown;
};

export async function POST(request: Request) {
  const limit = await consumeRateLimit(
    `forgot-pw-ip:${hashClientIp(getRequestIp(request))}`,
    RATE_LIMITS.signupPerIp,
  );

  if (!limit.allowed) {
    return tooManyRequests(limit, "Too many requests. Please try again later.");
  }

  const body = (await request.json().catch(() => ({}))) as ForgotPasswordPayload;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !isValidEmail(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const result = await createPasswordResetForUser(email);

  if (result.success && result.user && result.token) {
    await sendPasswordResetEmail({
      email: result.user.email,
      fullName: result.user.fullName,
      resetToken: result.token,
    }).catch((err) => {
      console.error("[forgot-password] Failed to send email:", err);
    });
  }

  // Always return identical success message to prevent user enumeration
  return NextResponse.json({
    success: true,
    message: "If an account exists with that email, a password reset link has been sent.",
  });
}
