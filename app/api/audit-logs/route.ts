import { NextResponse } from "next/server";
import { requirePermission } from "@/src/lib/access";
import { auditUser } from "@/src/lib/audit";
import { exportAuditCsv, listAuditLogs, parseAuditFilters } from "@/src/lib/audit-queries";
import { getCurrentSession } from "@/src/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Module 11 FE-5: the security and audit log (read-only; entries can't be changed).
 * `format=csv` downloads the filtered log and also needs the data-export permission.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "audit.view", request);

  if (forbidden) {
    return forbidden;
  }

  const params = new URL(request.url).searchParams;
  const filters = parseAuditFilters(params);

  if (params.get("format") === "csv") {
    const exportForbidden = requirePermission(session.user, "data.export", request);

    if (exportForbidden) {
      return exportForbidden;
    }

    const { csv, count } = await exportAuditCsv(session.user.workspaceId, filters);
    await auditUser(session.user, {
      action: "data.exported",
      category: "data",
      summary: `${session.user.fullName} exported the audit log (${count} entries)`,
      request,
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="assistdesk-audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(await listAuditLogs(session.user.workspaceId, filters));
}
