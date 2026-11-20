import { NextResponse } from "next/server";
import { auditUser } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";

/** Module 2 FE-1: how many days after the order the AI may still request a refund. */
export async function PUT(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const body = (await request.json().catch(() => ({}))) as { refundWindowDays?: unknown };
  const days = Number(body.refundWindowDays);

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return NextResponse.json({ error: "The refund window must be 1 to 365 days." }, { status: 400 });
  }

  await prisma.workspaceSetting.upsert({
    where: { workspaceId: session.user.workspaceId },
    update: { refundWindowDays: days },
    create: { workspaceId: session.user.workspaceId, refundWindowDays: days },
  });

  await auditUser(session.user, {
    action: "settings.refund_window",
    category: "settings",
    summary: `${session.user.fullName} set the refund window to ${days} days`,
    request,
  });

  return NextResponse.json({ refundWindowDays: days });
}
