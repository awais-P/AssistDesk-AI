import { NextResponse } from "next/server";
import {
  ACTION_LOG_PAGE_SIZE,
  actionLogSummary,
  listAgentRuns,
  listToolExecutions,
  parseActionLogFilters,
} from "@/src/lib/action-logs";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

/** Module 2 FE-5 Action Logs: reasoning runs or individual actions, filtered and sorted (UI-4). */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const filters = parseActionLogFilters(new URL(request.url).searchParams);

  const [result, summary, agents, tools] = await Promise.all([
    filters.view === "runs" ? listAgentRuns(workspaceId, filters) : listToolExecutions(workspaceId, filters),
    actionLogSummary(workspaceId, filters),
    prisma.aIAgent.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    // Every tool that has ever been called, including deleted ones (kept by key and name).
    prisma.toolExecution.findMany({ where: { workspaceId }, distinct: ["toolKey"], select: { toolKey: true, toolName: true }, orderBy: { toolKey: "asc" } }),
  ]);

  return NextResponse.json({
    view: filters.view,
    rows: result.rows,
    total: result.total,
    page: filters.page,
    pageSize: ACTION_LOG_PAGE_SIZE,
    summary,
    options: { agents, tools: tools.map((tool) => ({ key: tool.toolKey, name: tool.toolName })) },
  });
}
