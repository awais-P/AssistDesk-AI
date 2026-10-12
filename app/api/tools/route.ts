import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { hasRole, requireRole } from "@/src/lib/rbac";
import { HTTP_METHODS } from "@/src/lib/tools/http-tool";
import { ensureBuiltInTools } from "@/src/lib/tools/registry";
import {
  MAX_CUSTOM_TOOLS,
  type HttpToolInput,
  httpToolData,
  httpToolTemplates,
  serializeTool,
  sortTools,
  toolStats,
  validateHttpTool,
} from "@/src/lib/tools/tool-admin";

/** Module 2 FE-3: the workspace's tools (built-in actions + custom HTTP tools). */

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
  }

  const workspaceId = session.user.workspaceId;
  await ensureBuiltInTools(workspaceId);

  const [tools, stats, agents] = await Promise.all([
    prisma.agentTool.findMany({
      where: { workspaceId },
      include: { bindings: { select: { agentId: true } } },
      orderBy: [{ type: "asc" }, { createdAt: "asc" }],
    }),
    toolStats(workspaceId),
    prisma.aIAgent.findMany({ where: { workspaceId }, select: { id: true, name: true, toolsEnabled: true }, orderBy: { createdAt: "asc" } }),
  ]);

  return NextResponse.json({
    tools: sortTools(tools).map((tool) => serializeTool(tool, stats.get(tool.id))),
    agents,
    templates: httpToolTemplates(),
    methods: HTTP_METHODS,
    canManageHttp: hasRole(session.user.role, "ADMIN"),
    limits: { customTools: MAX_CUSTOM_TOOLS },
  });
}

/** Custom HTTP tools call outside systems with stored credentials, so Admins only (SEC-2). */
export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const workspaceId = session.user.workspaceId;
  const body = (await request.json().catch(() => ({}))) as HttpToolInput & { agentIds?: unknown };
  const checked = await validateHttpTool(body);

  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  if ((await prisma.agentTool.count({ where: { workspaceId, type: "HTTP" } })) >= MAX_CUSTOM_TOOLS) {
    return NextResponse.json({ error: `Up to ${MAX_CUSTOM_TOOLS} custom tools per workspace.` }, { status: 400 });
  }

  if (await prisma.agentTool.findFirst({ where: { workspaceId, key: checked.value.key }, select: { id: true } })) {
    return NextResponse.json({ error: `A tool called "${checked.value.key}" already exists. Choose another name.` }, { status: 409 });
  }

  const agentIds = Array.isArray(body.agentIds) ? body.agentIds.filter((id): id is string => typeof id === "string") : [];
  const agents = agentIds.length
    ? await prisma.aIAgent.findMany({ where: { workspaceId, id: { in: agentIds } }, select: { id: true } })
    : [];

  try {
    const tool = await prisma.agentTool.create({
      data: {
        workspaceId,
        type: "HTTP",
        ...httpToolData(checked.value),
        bindings: agents.length ? { create: agents.map((agent) => ({ agentId: agent.id })) } : undefined,
      },
      include: { bindings: { select: { agentId: true } } },
    });

    return NextResponse.json({ tool: serializeTool(tool) }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: `A tool called "${checked.value.key}" already exists. Choose another name.` }, { status: 409 });
    }

    throw error;
  }
}
