import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  createSession,
  createSlug,
  createUniqueUsername,
  createUniqueWorkspaceSlug,
  hashPassword,
} from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type SignupPayload = {
  fullName?: string;
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as SignupPayload;
  const fullName = body.fullName?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();

  if (!fullName || !email || !password) {
    return NextResponse.json(
      { error: "Please fill in full name, email, and password." },
      { status: 400 },
    );
  }

  if (password.length < 3) {
    return NextResponse.json(
      { error: "Password should be at least 3 characters for now." },
      { status: 400 },
    );
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username: email }],
    },
    select: { id: true },
  });

  if (existingUser) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const workspaceBase = `${fullName.split(" ")[0]} workspace`;
  const workspaceSlug = await createUniqueWorkspaceSlug(workspaceBase);
  const username = await createUniqueUsername(createSlug(email.split("@")[0] || fullName));

  const workspace = await prisma.workspace.create({
    data: {
      name: `${fullName.split(" ")[0]}'s Workspace`,
      slug: workspaceSlug,
      supportEmail: email,
      settings: {
        create: {},
      },
    },
  });

  const user = await prisma.user.create({
    data: {
      workspaceId: workspace.id,
      fullName,
      username,
      email,
      passwordHash: hashPassword(password),
      role: "OWNER",
    },
  });

  const session = await createSession(user.id);
  const response = NextResponse.json({
    success: true,
    redirectTo: "/setup",
  });

  response.cookies.set(AUTH_COOKIE_NAME, session.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });

  return response;
}
