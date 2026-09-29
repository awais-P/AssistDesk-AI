import { NextResponse } from "next/server";
import {
  createUniqueUsername,
  generateTemporaryPassword,
  getCurrentSession,
  hashPassword,
  isValidEmail,
} from "@/src/lib/auth";
import { createNotification } from "@/src/lib/notifications";
import { prisma } from "@/src/lib/prisma";
import { canAssignRole, requireRole } from "@/src/lib/rbac";

type CreateUsersPayload = {
  emails?: unknown;
  role?: unknown;
};

const publicUserSelect = {
  id: true,
  fullName: true,
  username: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

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

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const body = (await request.json().catch(() => ({}))) as CreateUsersPayload;
  const role = typeof body.role === "string" ? body.role : "AGENT";

  if (!canAssignRole(session.user, role)) {
    return NextResponse.json(
      { error: "You can only invite members with a role below your own (Admin, Manager or Agent)." },
      { status: 403 },
    );
  }

  const emails = (Array.isArray(body.emails) ? body.emails : [])
    .filter((email): email is string => typeof email === "string")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) {
    return NextResponse.json(
      { error: "Please enter at least one email address." },
      { status: 400 },
    );
  }

  const invalid = emails.find((email) => !isValidEmail(email));

  if (invalid) {
    return NextResponse.json(
      { error: `"${invalid}" is not a valid email address.` },
      { status: 400 },
    );
  }

  const uniqueEmails = [...new Set(emails)].slice(0, 20);
  const existingUsers = await prisma.user.findMany({
    where: { email: { in: uniqueEmails } },
    select: { email: true },
  });
  const existingEmailSet = new Set(existingUsers.map((user) => user.email));
  const newEmails = uniqueEmails.filter((email) => !existingEmailSet.has(email));

  if (newEmails.length === 0) {
    return NextResponse.json(
      { error: "All provided email addresses already have an AssistDesk account." },
      { status: 409 },
    );
  }

  const created = [];

  for (const email of newEmails) {
    const temporaryPassword = generateTemporaryPassword();
    const user = await prisma.user.create({
      data: {
        workspaceId: session.user.workspaceId,
        fullName: createNameFromEmail(email),
        username: await createUniqueUsername(email.split("@")[0] || "user"),
        email,
        passwordHash: await hashPassword(temporaryPassword),
        role: role as "ADMIN" | "MANAGER" | "AGENT",
        isActive: true,
        mustChangePassword: true,
      },
      select: publicUserSelect,
    });

    // Returned once so the admin can share it; only the bcrypt hash is stored.
    created.push({ ...user, temporaryPassword });
  }

  await createNotification({
    workspaceId: session.user.workspaceId,
    type: "TEAM_INVITE",
    title: `${session.user.fullName} added ${created.length} team member(s)`,
    body: created.map((user) => user.email).join(", "),
    link: "/dashboard/users",
  });

  return NextResponse.json({
    users: created,
    skipped: uniqueEmails.filter((email) => existingEmailSet.has(email)),
  });
}
