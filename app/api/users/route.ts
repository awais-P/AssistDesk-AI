import { NextResponse } from "next/server";
import {
  createUniqueUsername,
  getCurrentSession,
  hashPassword,
} from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type CreateUsersPayload = {
  emails?: string[];
  role?: "ADMIN" | "MANAGER" | "AGENT";
};

function createNameFromEmail(email: string) {
  const localPart = email.split("@")[0] || "user";

  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as CreateUsersPayload;
  const emails =
    body.emails
      ?.map((email) => email.trim().toLowerCase())
      .filter(Boolean) ?? [];

  if (emails.length === 0) {
    return NextResponse.json(
      { error: "Please enter at least one email address." },
      { status: 400 },
    );
  }

  const uniqueEmails = [...new Set(emails)];

  const existingUsers = await prisma.user.findMany({
    where: {
      email: {
        in: uniqueEmails,
      },
    },
    select: {
      email: true,
    },
  });

  const existingEmailSet = new Set(existingUsers.map((user) => user.email));
  const newEmails = uniqueEmails.filter((email) => !existingEmailSet.has(email));

  if (newEmails.length === 0) {
    return NextResponse.json(
      { error: "All provided email addresses already exist." },
      { status: 409 },
    );
  }

  const createdUsers = [];

  for (const email of newEmails) {
    const fullName = createNameFromEmail(email);
    const username = await createUniqueUsername(email.split("@")[0] || "user");

    const user = await prisma.user.create({
      data: {
        workspaceId: session.user.workspaceId,
        fullName,
        username,
        email,
        passwordHash: hashPassword("welcome123"),
        role: body.role || "AGENT",
        isActive: true,
      },
    });

    createdUsers.push(user);
  }

  return NextResponse.json({ users: createdUsers });
}
