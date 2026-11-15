import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { requirePermission } from "@/src/lib/access";
import { auditUser } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import { parseCustomRoleInput } from "@/src/lib/custom-roles";
import { PERMISSIONS } from "@/src/lib/permissions";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

const roleSelect = { id: true, name: true, description: true, baseRole: true, permissions: true, deniedPermissions: true, createdAt: true, _count: { select: { users: true } } } as const;

/** Module 11 FE-3/FE-4: the permission matrix, custom roles and who has which role. */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "roles.manage", request);

  if (forbidden) {
    return forbidden;
  }

  const roles = await prisma.customRole.findMany({ where: { workspaceId: session.user.workspaceId }, select: roleSelect, orderBy: { name: "asc" } });
  const members = await prisma.user.findMany({
    where: { workspaceId: session.user.workspaceId, isActive: true },
    select: { id: true, fullName: true, email: true, role: true, customRoleId: true },
    orderBy: { fullName: "asc" },
  });

  return NextResponse.json({ permissions: PERMISSIONS, roles, members, me: { id: session.user.id, role: session.user.role } });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "roles.manage", request);

  if (forbidden) {
    return forbidden;
  }

  const parsed = parseCustomRoleInput((await request.json().catch(() => ({}))) as Record<string, unknown>);

  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const duplicate = await prisma.customRole.findFirst({ where: { workspaceId: session.user.workspaceId, name: { equals: parsed.value.name, mode: "insensitive" } }, select: { id: true } });

  if (duplicate) {
    return NextResponse.json({ error: "A role with this name already exists." }, { status: 409 });
  }

  try {
    const role = await prisma.customRole.create({ data: { workspaceId: session.user.workspaceId, ...parsed.value }, select: roleSelect });
    await auditUser(session.user, {
      action: "role.created",
      category: "users",
      summary: `${session.user.fullName} created the role "${role.name}" (based on ${role.baseRole.toLowerCase()})`,
      targetType: "custom_role",
      targetId: role.id,
      metadata: { baseRole: role.baseRole, added: role.permissions, removed: role.deniedPermissions },
      request,
    });
    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A role with this name already exists." }, { status: 409 });
    }
    throw error;
  }
}
