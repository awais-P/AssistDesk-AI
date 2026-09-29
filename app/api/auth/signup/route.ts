import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import {
  AUTH_COOKIE_NAME,
  createSession,
  createSlug,
  createUniqueUsername,
  createUniqueWorkspaceSlug,
  hashPassword,
  isValidEmail,
  sessionCookieOptions,
  validateNewPassword,
} from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import {
  RATE_LIMITS,
  consumeRateLimit,
  getRequestIp,
  hashClientIp,
  tooManyRequests,
} from "@/src/lib/rate-limit";

type SignupPayload = {
  fullName?: unknown;
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  // Workspace creation is expensive and abusable: 5 sign-ups per IP per hour.
  const limit = await consumeRateLimit(
    `signup-ip:${hashClientIp(getRequestIp(request))}`,
    RATE_LIMITS.signupPerIp,
  );

  if (!limit.allowed) {
    return tooManyRequests(limit, "Too many sign-ups from this network.");
  }

  const body = (await request.json().catch(() => ({}))) as SignupPayload;
  const fullName = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 80) : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!fullName || !email || !password) {
    return NextResponse.json(
      { error: "Please fill in full name, email, and password." },
      { status: 400 },
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address, like name@company.com." },
      { status: 400 },
    );
  }

  const passwordError = validateNewPassword(password);

  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username: email }],
    },
    select: { id: true },
  });

  if (existingUser) {
    return NextResponse.json(
      { error: "An account with this email already exists. Try signing in instead." },
      { status: 409 },
    );
  }

  const firstName = fullName.split(" ")[0];
  const workspaceSlug = await createUniqueWorkspaceSlug(`${firstName} workspace`);
  const username = await createUniqueUsername(createSlug(email.split("@")[0] || fullName));
  const passwordHash = await hashPassword(password);

  let user;

  try {
    // Workspace and owner are created together so a failure never leaves an orphan workspace.
    user = await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: `${firstName}'s Workspace`,
          slug: workspaceSlug,
          supportEmail: email,
          settings: {
            create: {},
          },
        },
      });

      return tx.user.create({
        data: {
          workspaceId: workspace.id,
          fullName,
          username,
          email,
          passwordHash,
          role: "OWNER",
        },
        select: { id: true },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "An account with this email already exists. Try signing in instead." },
        { status: 409 },
      );
    }

    throw error;
  }

  const session = await createSession(user.id);
  const response = NextResponse.json({
    success: true,
    redirectTo: "/setup",
  });

  response.cookies.set(AUTH_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));

  return response;
}
