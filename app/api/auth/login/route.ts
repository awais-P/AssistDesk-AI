import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  createSession,
  verifyPassword,
} from "@/src/lib/auth";
import { ensureDemoData } from "@/src/lib/demo-data";
import { prisma } from "@/src/lib/prisma";

type LoginPayload = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as LoginPayload;
  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();

  await ensureDemoData();

  if (!email || !password) {
    return NextResponse.json(
      { error: "Please enter both username and password." },
      { status: 400 },
    );
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: email }, { email }],
      isActive: true,
    },
  });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json(
      { error: "Invalid username, email, or password." },
      { status: 401 },
    );
  }

  const session = await createSession(user.id);
  const response = NextResponse.json({ success: true });

  response.cookies.set(AUTH_COOKIE_NAME, session.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });

  return response;
}
