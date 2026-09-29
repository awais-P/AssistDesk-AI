import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  getCurrentSession,
  hashPassword,
  revokeUserSessions,
  validateNewPassword,
  verifyPassword,
} from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type ChangePasswordPayload = {
  currentPassword?: unknown;
  newPassword?: unknown;
};

/** Change your own password; every other device is signed out. */
export async function PATCH(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ChangePasswordPayload;
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });
  const verification = await verifyPassword(currentPassword, user?.passwordHash ?? null);

  if (!verification.valid) {
    return NextResponse.json({ error: "Your current password is incorrect." }, { status: 400 });
  }

  const passwordError = validateNewPassword(newPassword);

  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "Choose a new password that is different from the current one." },
      { status: 400 },
    );
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
    select: { id: true },
  });

  const currentToken = (await cookies()).get(AUTH_COOKIE_NAME)?.value ?? null;
  await revokeUserSessions(session.user.id, currentToken);

  return NextResponse.json({ success: true });
}
