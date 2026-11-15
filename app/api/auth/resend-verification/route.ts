import { NextResponse } from "next/server";
import {
  createEmailVerificationForUser,
  isValidEmail,
} from "@/src/lib/auth";
import { sendVerificationEmail } from "@/src/lib/mailer";
import { prisma } from "@/src/lib/prisma";
import {
  RATE_LIMITS,
  consumeRateLimit,
  getRequestIp,
  hashClientIp,
  tooManyRequests,
} from "@/src/lib/rate-limit";

type ResendPayload = {
  email?: unknown;
};

export async function POST(request: Request) {
  const limit = await consumeRateLimit(
    `resend-ip:${hashClientIp(getRequestIp(request))}`,
    RATE_LIMITS.signupPerIp,
  );

  if (!limit.allowed) {
    return tooManyRequests(limit, "Too many requests. Please try again later.");
  }

  const body = (await request.json().catch(() => ({}))) as ResendPayload;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !isValidEmail(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const user = await prisma.user.findFirst({
    where: { email },
    select: { id: true, email: true, fullName: true, isEmailVerified: true, emailVerified: true },
  });

  if (!user) {
    // Return generic success to prevent email enumeration
    return NextResponse.json({
      success: true,
      message: "If an unverified account exists with that email, a verification link has been sent.",
    });
  }

  if (user.isEmailVerified || user.emailVerified) {
    return NextResponse.json({
      success: true,
      alreadyVerified: true,
      message: "This email is already verified. You can sign in.",
    });
  }

  const { token } = await createEmailVerificationForUser(user.id);

  await sendVerificationEmail({
    email: user.email,
    fullName: user.fullName,
    verificationToken: token,
  }).catch((err) => {
    console.error("[resend-verification] Failed to send email:", err);
  });

  return NextResponse.json({
    success: true,
    message: "A new confirmation email has been sent. Please check your inbox.",
  });
}
