import { NextResponse } from "next/server";
import { getAgentRunDetail } from "@/src/lib/action-logs";
import { getCurrentSession } from "@/src/lib/auth";

type RunRouteContext = { params: Promise<{ id: string }> };

/** Module 2 FE-5: one reasoning run's chain of thought with its actions. */
export async function GET(_request: Request, context: RunRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const run = await getAgentRunDetail(session.user.workspaceId, id);

  if (!run) {
    return NextResponse.json({ error: "Run not found in this workspace." }, { status: 404 });
  }

  return NextResponse.json({ run });
}
