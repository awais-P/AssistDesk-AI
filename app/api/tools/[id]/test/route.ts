import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";
import { testTool } from "@/src/lib/tools/registry";
import { serializeTool } from "@/src/lib/tools/tool-admin";

type ToolTestContext = { params: Promise<{ id: string }> };

/**
 * Module 2 FE-3 "Test tool": runs one call with sample inputs and logs it as a TEST.
 * Built-in actions that change data are simulated; custom HTTP tools really call the
 * API, so testing them needs an Admin (SEC-2).
 */
export async function POST(request: Request, context: ToolTestContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const tool = await prisma.agentTool.findFirst({ where: { id, workspaceId: session.user.workspaceId } });

  if (!tool) {
    return NextResponse.json({ error: "Tool not found in this workspace." }, { status: 404 });
  }

  if (tool.type === "HTTP") {
    const admin = requireRole(session.user, "ADMIN");

    if (admin) {
      return admin;
    }
  }

  const body = (await request.json().catch(() => ({}))) as { input?: unknown };
  const input = body.input && typeof body.input === "object" ? { reason: "Admin test from the Tools page", ...(body.input as object) } : { reason: "Admin test from the Tools page" };
  const startedAt = Date.now();
  const result = await testTool(session.user.workspaceId, tool, input, session.user);
  const updated = await prisma.agentTool.findUniqueOrThrow({ where: { id: tool.id }, include: { bindings: { select: { agentId: true } } } });

  return NextResponse.json({
    ok: result.ok,
    status: "status" in result ? result.status : "ERROR",
    output: "output" in result ? result.output : { error: result.error },
    latencyMs: Date.now() - startedAt,
    tool: serializeTool(updated),
  });
}
