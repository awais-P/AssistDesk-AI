import { NextResponse } from "next/server";
import { requirePermission } from "@/src/lib/access";
import { auditUser } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import { loadEscalationSettings } from "@/src/lib/escalation";
import { parseEscalationSettings } from "@/src/lib/escalation-queries";
import { prisma } from "@/src/lib/prisma";

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

  const forbidden = requirePermission(session.user, "escalations.settings", request);

  if (forbidden) {
    return forbidden;
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseEscalationSettings(body);

  if (parsed.error !== undefined) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { workspaceId } = session.user;
  await auditUser(session.user, {
    action: "settings.escalation_updated",
    category: "settings",
    summary: `${session.user.fullName} changed the escalation rules`,
    metadata: parsed.data as Record<string, string | number | boolean | string[]>,
    request,
  });
  await prisma.workspaceSetting.upsert({
    where: { workspaceId },
    create: { workspaceId, ...parsed.data },
    update: parsed.data,
    select: { id: true },
  });

  return NextResponse.json({ settings: await loadEscalationSettings(workspaceId) });
}
