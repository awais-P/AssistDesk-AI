import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { loadEscalationSettings } from "@/src/lib/escalation";
import { parseEscalationSettings } from "@/src/lib/escalation-queries";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";

/** Module 9 escalation rules: triggers, sentiment threshold, trigger phrases and response time. */
export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({ settings: await loadEscalationSettings(session.user.workspaceId) });
}

export async function PATCH(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseEscalationSettings(body);

  if (parsed.error !== undefined) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { workspaceId } = session.user;
  await prisma.workspaceSetting.upsert({
    where: { workspaceId },
    create: { workspaceId, ...parsed.data },
    update: parsed.data,
    select: { id: true },
  });

  return NextResponse.json({ settings: await loadEscalationSettings(workspaceId) });
}
