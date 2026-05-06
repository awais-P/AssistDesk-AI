import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type UpdateProfilePayload = {
  fullName?: string;
  email?: string;
};

export async function PATCH(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as UpdateProfilePayload;
  const fullName = body.fullName?.trim();
  const email = body.email?.trim().toLowerCase();

  if (!fullName || !email) {
    return NextResponse.json(
      { error: "Full name and email are required." },
      { status: 400 },
    );
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      email,
      id: {
        not: session.user.id,
      },
    },
    select: {
      id: true,
    },
  });

  if (existingUser) {
    return NextResponse.json(
      { error: "This email is already in use." },
      { status: 409 },
    );
  }

  const user = await prisma.user.update({
    where: {
      id: session.user.id,
    },
    data: {
      fullName,
      email,
    },
  });

  return NextResponse.json({ user });
}
