import { NextResponse } from "next/server";
import { getCurrentSession, revokeUserSessions } from "@/src/lib/auth";
import { auditUser } from "@/src/lib/audit";
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
  /** Module 11 FE-4: an admin-defined role, or null for the built-in role only. */
  customRoleId?: unknown;
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
  customRole: { select: { id: true, name: true } },
} as const;

async function loadTarget(id: string, workspaceId: string) {
  return prisma.user.findFirst({
    where: { id, workspaceId },
    select: { id: true, role: true, email: true, customRoleId: true },
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

  const data: { role?: "ADMIN" | "MANAGER" | "AGENT"; isActive?: boolean; customRoleId?: string | null } = {};
  let customRoleName: string | null = null;

  if (typeof body.role !== "undefined") {
    if (typeof body.role !== "string" || !canAssignRole(session.user, body.role)) {
      return NextResponse.json(
        { error: "You can only assign a role below your own (Admin, Manager or Agent)." },
        { status: 403 },
      );
    }

    data.role = body.role as "ADMIN" | "MANAGER" | "AGENT";
    // Choosing a built-in role replaces a custom one.
    data.customRoleId = null;
  }

  if (typeof body.customRoleId !== "undefined") {
    if (body.customRoleId === null) {
      data.customRoleId = null;
    } else {
      const customRole =
        typeof body.customRoleId === "string"
          ? await prisma.customRole.findFirst({ where: { id: body.customRoleId, workspaceId: session.user.workspaceId }, select: { id: true, name: true, baseRole: true } })
          : null;

      if (!customRole) {
        return NextResponse.json({ error: "That custom role does not exist in this workspace." }, { status: 400 });
      }

      if (!canAssignRole(session.user, customRole.baseRole)) {
        return NextResponse.json({ error: "You can only give roles below your own." }, { status: 403 });
      }

      // The custom role's base level becomes the member's role, so every role check agrees.
      data.customRoleId = customRole.id;
      data.role = customRole.baseRole as "ADMIN" | "MANAGER" | "AGENT";
      customRoleName = customRole.name;
    }
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

  if (data.customRoleId !== undefined && data.customRoleId !== target.customRoleId) {
    await auditUser(session.user, {
      action: "user.custom_role_changed",
      category: "users",
      summary: data.customRoleId
        ? `${session.user.fullName} gave ${user.fullName} the custom role "${customRoleName}"`
        : `${session.user.fullName} removed ${user.fullName}'s custom role`,
      targetType: "user",
      targetId: id,
      metadata: { customRoleId: data.customRoleId, customRole: customRoleName },
      request,
    });
  }

  if (data.role && data.role !== target.role) {
    await auditUser(session.user, {
      action: "user.role_changed",
      category: "users",
      summary: `${session.user.fullName} changed ${user.fullName}'s role from ${target.role.toLowerCase()} to ${data.role.toLowerCase()}`,
      targetType: "user",
      targetId: id,
      metadata: { from: target.role, to: data.role },
      request,
    });
  }

  if (typeof data.isActive === "boolean") {
    await auditUser(session.user, {
      action: data.isActive ? "user.reactivated" : "user.deactivated",
      category: "users",
      summary: `${session.user.fullName} ${data.isActive ? "reactivated" : "deactivated"} ${user.fullName}`,
      targetType: "user",
      targetId: id,
      request,
    });
  }

  return NextResponse.json({ user });
}

export async function DELETE(request: Request, context: UserRouteContext) {
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
  await auditUser(session.user, {
    action: "user.deleted",
    category: "users",
    summary: `${session.user.fullName} removed ${target.email ?? "a team member"}`,
    targetType: "user",
    targetId: id,
    metadata: { email: target.email ?? null, role: target.role },
    request,
  });

  return NextResponse.json({ success: true });
}
