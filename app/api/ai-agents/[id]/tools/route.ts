import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { MAX_INTENT_RULES, parseIntentRules } from "@/src/lib/agent-engine/intent-rules";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";
import { BUILT_IN_BY_KEY } from "@/src/lib/tools/builtin-tools";
import { ensureBuiltInTools } from "@/src/lib/tools/registry";
import { sortTools } from "@/src/lib/tools/tool-admin";

type AgentToolsContext = { params: Promise<{ id: string }> };

/** Module 2 FE-3/FE-4: which actions an agent may take, and the intent → action rules. */

async function loadAgentTools(workspaceId: string, agentId: string) {
  const agent = await prisma.aIAgent.findFirst({
    where: { id: agentId, workspaceId },
    select: {
      id: true,
      name: true,
      toolsEnabled: true,
      maxToolSteps: true,
      escalateOnToolFailure: true,
      intentRules: true,
      toolBindings: { select: { toolId: true } },
    },
  });

  if (!agent) {
    return null;
  }

  const boundIds = new Set(agent.toolBindings.map((binding) => binding.toolId));
  const tools = await prisma.agentTool.findMany({
    where: { workspaceId },
    select: { id: true, key: true, name: true, description: true, type: true, isEnabled: true, requiresConfirmation: true, httpMethod: true, builtInKey: true, lastTestStatus: true, createdAt: true },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      toolsEnabled: agent.toolsEnabled,
      maxToolSteps: agent.maxToolSteps,
      escalateOnToolFailure: agent.escalateOnToolFailure,
      intentRules: parseIntentRules(agent.intentRules),
    },
    tools: sortTools(tools).map((tool) => ({
      ...tool,
      effect: tool.builtInKey ? (BUILT_IN_BY_KEY.get(tool.builtInKey)?.effect ?? "READ") : (tool.httpMethod ?? "GET") === "GET" ? "READ" : "WRITE",
      bound: boundIds.has(tool.id),
    })),
  };
}

export async function GET(_request: Request, context: AgentToolsContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  await ensureBuiltInTools(session.user.workspaceId);
  const data = await loadAgentTools(session.user.workspaceId, id);

  if (!data) {
    return NextResponse.json({ error: "AI agent not found in this workspace." }, { status: 404 });
  }

  return NextResponse.json(data);
}

type AgentToolsPayload = {
  toolsEnabled?: unknown;
  toolIds?: unknown;
  maxToolSteps?: unknown;
  escalateOnToolFailure?: unknown;
  intentRules?: unknown;
};

export async function PUT(request: Request, context: AgentToolsContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const workspaceId = session.user.workspaceId;
  const current = await loadAgentTools(workspaceId, id);

  if (!current) {
    return NextResponse.json({ error: "AI agent not found in this workspace." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as AgentToolsPayload;
  const workspaceToolIds = new Set(current.tools.map((tool) => tool.id));
  const toolIds = Array.isArray(body.toolIds)
    ? [...new Set(body.toolIds.filter((toolId): toolId is string => typeof toolId === "string"))]
    : current.tools.filter((tool) => tool.bound).map((tool) => tool.id);

  if (toolIds.some((toolId) => !workspaceToolIds.has(toolId))) {
    return NextResponse.json({ error: "One of the selected tools no longer exists. Reload the page and try again." }, { status: 400 });
  }

  const toolsEnabled = typeof body.toolsEnabled === "boolean" ? body.toolsEnabled : current.agent.toolsEnabled;

  if (toolsEnabled && toolIds.length === 0) {
    return NextResponse.json({ error: "Choose at least one action this agent may take, or switch actions off." }, { status: 400 });
  }

  const steps = body.maxToolSteps === undefined ? current.agent.maxToolSteps : Number(body.maxToolSteps);

  if (!Number.isInteger(steps) || steps < 1 || steps > 8) {
    return NextResponse.json({ error: "Reasoning steps must be a whole number from 1 to 8." }, { status: 400 });
  }

  // Rules may only point at actions this agent is allowed to take.
  const boundKeys = current.tools.filter((tool) => toolIds.includes(tool.id)).map((tool) => tool.key);
  let intentRules = current.agent.intentRules.filter((rule) => boundKeys.includes(rule.toolKey));

  if (body.intentRules !== undefined) {
    if (!Array.isArray(body.intentRules)) {
      return NextResponse.json({ error: "Intent rules must be a list." }, { status: 400 });
    }

    if (body.intentRules.length > MAX_INTENT_RULES) {
      return NextResponse.json({ error: `Up to ${MAX_INTENT_RULES} intent rules per agent.` }, { status: 400 });
    }

    intentRules = parseIntentRules(body.intentRules, boundKeys);

    if (intentRules.length !== body.intentRules.length) {
      return NextResponse.json(
        { error: "Every intent rule needs at least one phrase (2+ characters) and an action this agent is allowed to take." },
        { status: 400 },
      );
    }
  }

  await prisma.$transaction([
    prisma.aIAgent.update({
      where: { id: current.agent.id },
      data: {
        toolsEnabled,
        maxToolSteps: steps,
        escalateOnToolFailure: typeof body.escalateOnToolFailure === "boolean" ? body.escalateOnToolFailure : current.agent.escalateOnToolFailure,
        intentRules: intentRules as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    }),
    prisma.agentToolBinding.deleteMany({ where: { agentId: current.agent.id, toolId: { notIn: toolIds } } }),
    prisma.agentToolBinding.createMany({ data: toolIds.map((toolId) => ({ agentId: current.agent.id, toolId })), skipDuplicates: true }),
  ]);

  return NextResponse.json(await loadAgentTools(workspaceId, id));
}
