import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { loadAnalyticsReports, parseAnalyticsRange, workspaceTimeZone } from "@/src/lib/analytics";

/** Reports: frequently asked questions and customer behaviour (Module 4 FE-4). */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const range = parseAnalyticsRange(
    new URL(request.url).searchParams,
    await workspaceTimeZone(session.user.workspaceId),
  );

  return NextResponse.json(await loadAnalyticsReports(session.user.workspaceId, range));
}
