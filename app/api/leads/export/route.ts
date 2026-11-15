import { NextResponse } from "next/server";
import { auditUser } from "@/src/lib/audit";
import { requirePermission } from "@/src/lib/access";
import { getCurrentSession } from "@/src/lib/auth";
import { exportLeadsCsv, parseLeadFilters } from "@/src/lib/lead-list";

/**
 * CSV export of the filtered lead list (Module 8 FE-4), for CRMs and email tools.
 * Contains personal data, so it needs the Manager role or higher.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "data.export", request);

  if (forbidden) {
    return forbidden;
  }

  const { csv, count } = await exportLeadsCsv(
    session.user.workspaceId,
    parseLeadFilters(new URL(request.url).searchParams),
    session.user.id,
  );
  const date = new Date().toISOString().slice(0, 10);

  await auditUser(session.user, {
    action: "data.exported",
    category: "data",
    summary: `${session.user.fullName} exported leads as CSV (${count} rows)`,
    metadata: { query: new URL(request.url).search.slice(0, 300) },
    request,
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="assistdesk-leads-${date}.csv"`,
      "Cache-Control": "no-store",
      "X-Lead-Count": String(count),
    },
  });
}
