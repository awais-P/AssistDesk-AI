import { NextResponse } from "next/server";
import { getCurrentSession, isValidEmail } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type UpdateProfilePayload = {
  fullName?: unknown;
  email?: unknown;
};

export async function PATCH(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as UpdateProfilePayload;
  const fullName = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 80) : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!fullName || !email) {
    return NextResponse.json(
      { error: "Full name and email are required." },
      { status: 400 },
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address, like name@company.com." },
      { status: 400 },
    );
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username: email }],
      id: { not: session.user.id },
    },
    select: { id: true },
  });

  if (existingUser) {
    return NextResponse.json(
      { error: "This email is already used by another account." },
      { status: 409 },
    );
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { fullName, email },
    select: { id: true, fullName: true, email: true, username: true, role: true },
  });

  return NextResponse.json({ user });
}
