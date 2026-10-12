import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  checkLoginRateLimit,
  clearFailedLogins,
  createSession,
  hashPassword,
  recordFailedLogin,
  sessionCookieOptions,
  verifyPassword,
} from "@/src/lib/auth";
import { ensureDemoData } from "@/src/lib/demo-data";
import { prisma } from "@/src/lib/prisma";
import { getWorkspaceSetupRedirect, getWorkspaceSetupState } from "@/src/lib/setup";

type LoginPayload = {
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as LoginPayload;
  const identifier = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!identifier || !password) {
    return NextResponse.json(
      { error: "Please enter both your email (or username) and password." },
      { status: 400 },
    );
  }

  const retryAfter = await checkLoginRateLimit(identifier, request);

  if (retryAfter > 0) {
    return NextResponse.json(
      {
        error: `Too many failed sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  // Demo data is only for local development and must be switched on explicitly.
  await ensureDemoData();

  const user = await prisma.user.findFirst({
    where: {
      isActive: true,
      ...(identifier.includes("@") ? { email: identifier } : { username: identifier }),
    },
    omit: { passwordHash: false },
  });
  const verification = user
    ? await verifyPassword(password, user.passwordHash)
    : { valid: false, needsRehash: false };

  if (!user || !verification.valid) {
    await recordFailedLogin(identifier, request);

    return NextResponse.json(
      { error: "Invalid email/username or password." },
      { status: 401 },
    );
  }

  await clearFailedLogins(identifier, request);

  if (verification.needsRehash) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
      select: { id: true },
    });
  }

  const workspaceState = await getWorkspaceSetupState(user.workspaceId);
  const redirectTo = user.mustChangePassword
    ? "/dashboard/profile?changePassword=1"
    : getWorkspaceSetupRedirect(workspaceState);
  const session = await createSession(user.id);
  const response = NextResponse.json({ success: true, redirectTo });

  response.cookies.set(AUTH_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));

  return response;
}
