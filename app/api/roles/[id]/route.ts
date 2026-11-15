import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { requirePermission } from "@/src/lib/access";
import { auditUser } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import { parseCustomRoleInput } from "@/src/lib/custom-roles";
import { prisma } from "@/src/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

async function authorize(request: Request, context: RouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) as Response };
  }

  const forbidden = requirePermission(session.user, "roles.manage", request);

  if (forbidden) {
    return { response: forbidden as Response };
  }

  const { id } = await context.params;
  const role = await prisma.customRole.findFirst({ where: { id, workspaceId: session.user.workspaceId } });

  if (!role) {
    return { response: NextResponse.json({ error: "Role not found." }, { status: 404 }) as Response };
  }

  return { session, role, response: undefined };
}

/** Edits a custom role. A new base level is applied to everyone who has the role. */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorize(request, context);

  if (auth.response) {
    return auth.response;
  }

  const { session, role } = auth;
  const parsed = parseCustomRoleInput((await request.json().catch(() => ({}))) as Record<string, unknown>);

  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const duplicate = await prisma.customRole.findFirst({
    where: { workspaceId: role.workspaceId, id: { not: role.id }, name: { equals: parsed.value.name, mode: "insensitive" } },
    select: { id: true },
  });

  if (duplicate) {
    return NextResponse.json({ error: "A role with this name already exists." }, { status: 409 });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.customRole.update({ where: { id: role.id }, data: parsed.value });
      // Owners keep their level; everyone else follows the role's base level.
      await tx.user.updateMany({ where: { customRoleId: role.id, role: { not: "OWNER" } }, data: { role: parsed.value.baseRole } });
      return saved;
    });

    await auditUser(session.user, {
      action: "role.updated",
      category: "users",
      summary: `${session.user.fullName} changed the role "${updated.name}"`,
      targetType: "custom_role",
      targetId: role.id,
      metadata: {
        baseRole: { from: role.baseRole, to: updated.baseRole },
        added: updated.permissions,
        removed: updated.deniedPermissions,
      },
      request,
    });
    return NextResponse.json({ role: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A role with this name already exists." }, { status: 409 });
    }
    throw error;
  }
}

/** Deletes a custom role; its members keep the role's base level. */
export async function DELETE(request: Request, context: RouteContext) {
  const auth = await authorize(request, context);

  if (auth.response) {
    return auth.response;
  }

  const members = await prisma.user.count({ where: { customRoleId: auth.role.id } });
  await prisma.customRole.delete({ where: { id: auth.role.id } });
  await auditUser(auth.session.user, {
    action: "role.deleted",
    category: "users",
    summary: `${auth.session.user.fullName} deleted the role "${auth.role.name}"${members ? ` (${members} member(s) keep the ${auth.role.baseRole.toLowerCase()} level)` : ""}`,
    targetType: "custom_role",
    targetId: auth.role.id,
    request,
  });

  return NextResponse.json({ success: true });
}
