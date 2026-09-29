import { NextResponse } from "next/server";
import { getCurrentSession, revokeUserSessions } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { canAssignRole, canManageMember, requireRole } from "@/src/lib/rbac";

type UserRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type UpdateUserPayload = {
  role?: unknown;
  isActive?: unknown;
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

async function loadTarget(id: string, workspaceId: string) {
  return prisma.user.findFirst({
    where: { id, workspaceId },
    select: { id: true, role: true },
  });
}

export async function PATCH(request: Request, context: UserRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as UpdateUserPayload;
  const target = await loadTarget(id, session.user.workspaceId);

  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (!canManageMember(session.user, target)) {
    return NextResponse.json(
      {
        error:
          target.id === session.user.id
            ? "You can't change your own role or status. Ask another admin."
            : "You can't change the workspace owner or someone with the same or a higher role.",
      },
      { status: 403 },
    );
  }

  const data: { role?: "ADMIN" | "MANAGER" | "AGENT"; isActive?: boolean } = {};

  if (typeof body.role !== "undefined") {
    if (typeof body.role !== "string" || !canAssignRole(session.user, body.role)) {
      return NextResponse.json(
        { error: "You can only assign a role below your own (Admin, Manager or Agent)." },
        { status: 403 },
      );
    }

    data.role = body.role as "ADMIN" | "MANAGER" | "AGENT";
  }

  if (typeof body.isActive !== "undefined") {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be true or false." }, { status: 400 });
    }

    data.isActive = body.isActive;
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: publicUserSelect,
  });

  if (data.isActive === false) {
    await revokeUserSessions(id);
  }

  return NextResponse.json({ user });
}

export async function DELETE(_request: Request, context: UserRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const target = await loadTarget(id, session.user.workspaceId);

  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (!canManageMember(session.user, target)) {
    return NextResponse.json(
      {
        error:
          target.id === session.user.id
            ? "You can't delete your own account from this page."
            : "You can't remove the workspace owner or someone with the same or a higher role.",
      },
      { status: 403 },
    );
  }

  await prisma.user.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
