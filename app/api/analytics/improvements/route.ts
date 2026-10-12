import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { loadImprovementAreas, parseAnalyticsRange, workspaceTimeZone } from "@/src/lib/analytics";

/** Improvement areas for training the assistant (Module 4 FE-5). */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const range = parseAnalyticsRange(
    new URL(request.url).searchParams,
    await workspaceTimeZone(session.user.workspaceId),
  );

  return NextResponse.json(await loadImprovementAreas(session.user.workspaceId, range));
}
