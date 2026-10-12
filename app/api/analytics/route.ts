import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { loadAnalyticsDashboard, parseAnalyticsRange, workspaceTimeZone } from "@/src/lib/analytics";

/**
 * Analytics dashboard data (Module 4 FE-1/FE-3, SRS FR-11.1–11.7).
 * `range=24h|7d|30d|90d` or `from=&to=` (YYYY-MM-DD, max 180 days), optional `channel`.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const range = parseAnalyticsRange(
    new URL(request.url).searchParams,
    await workspaceTimeZone(session.user.workspaceId),
  );

  return NextResponse.json(await loadAnalyticsDashboard(session.user.workspaceId, range));
}
