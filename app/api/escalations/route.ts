import { NextResponse } from "next/server";
import { auditUser } from "@/src/lib/audit";
import { requirePermission } from "@/src/lib/access";
import { getCurrentSession } from "@/src/lib/auth";
import { ESCALATION_VIEWS, type EscalationView, escalationStats, escalationsToCsv, listEscalations } from "@/src/lib/escalation-queries";
import { can } from "@/src/lib/permissions";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Module 9 escalation queue. `view` = queue | mine | in_progress | resolved | all;
 * `format=csv` downloads the list for reporting.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const requested = url.searchParams.get("view") ?? "queue";
  const view = (ESCALATION_VIEWS as string[]).includes(requested) ? (requested as EscalationView) : "queue";
  const { workspaceId, id: userId } = session.user;

  if (url.searchParams.get("format") === "csv") {
    const forbidden = requirePermission(session.user, "data.export", request);
    if (forbidden) return forbidden;
    const items = await listEscalations({ workspaceId, userId, view, take: 2000 });
    await auditUser(session.user, {
      action: "data.exported",
      category: "data",
      summary: `${session.user.fullName} exported escalations (${view}) as CSV (${items.length} rows)`,
      request,
    });
    return new NextResponse(escalationsToCsv(items), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="escalations-${view}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const [items, stats, members] = await Promise.all([
    listEscalations({ workspaceId, userId, view }),
    escalationStats(workspaceId),
    prisma.user.findMany({ where: { workspaceId, isActive: true }, select: { id: true, fullName: true, role: true }, orderBy: { fullName: "asc" } }),
  ]);

  return NextResponse.json({ items, stats, members, me: { id: userId, role: session.user.role, canExport: can(session.user, "data.export"), canAssign: can(session.user, "escalations.assign") } });
}
