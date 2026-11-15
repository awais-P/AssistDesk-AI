import { NextResponse } from "next/server";
import { requirePermission } from "@/src/lib/access";
import { auditUser } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

/** Revokes a key at once. The record stays (revoked) so the audit trail keeps its name. */
export async function DELETE(request: Request, context: RouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "apikeys.manage", request);

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const key = await prisma.apiKey.findFirst({ where: { id, workspaceId: session.user.workspaceId }, select: { id: true, name: true, prefix: true, revokedAt: true } });

  if (!key) {
    return NextResponse.json({ error: "API key not found." }, { status: 404 });
  }

  if (!key.revokedAt) {
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() }, select: { id: true } });
    await auditUser(session.user, {
      action: "api_key.revoked",
      category: "api",
      summary: `${session.user.fullName} revoked the API key "${key.name}" (${key.prefix}…)`,
      targetType: "api_key",
      targetId: id,
      request,
    });
  }

  return NextResponse.json({ success: true });
}
