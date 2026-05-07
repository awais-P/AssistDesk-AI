import { NextResponse } from "next/server";
import { ensureAgentAutomationDefaults } from "@/src/lib/agent-automations";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type AgentAutomationRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type AutomationPayload = {
  id?: string;
  isEnabled?: boolean;
  summary?: string;
};

export async function GET(
  _request: Request,
  context: AgentAutomationRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;

  const agent = await prisma.aIAgent.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!agent) {
    return NextResponse.json(
      { error: "AI agent not found in this workspace." },
      { status: 404 },
    );
  }

  const automations = await ensureAgentAutomationDefaults(
    session.user.workspaceId,
    agent.id,
  );

  return NextResponse.json({ automations });
}

export async function POST(
  request: Request,
  context: AgentAutomationRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: agentId } = await context.params;
  const body = (await request.json()) as AutomationPayload;

  const agent = await prisma.aIAgent.findFirst({
    where: {
      id: agentId,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!agent) {
    return NextResponse.json(
      { error: "AI agent not found in this workspace." },
      { status: 404 },
    );
  }

  if (!body.id) {
    return NextResponse.json(
      { error: "Automation id is required." },
      { status: 400 },
    );
  }

  const automation = await prisma.agentAutomation.findFirst({
    where: {
      id: body.id,
      agentId,
      workspaceId: session.user.workspaceId,
    },
  });

  if (!automation) {
    return NextResponse.json(
      { error: "Automation not found for this agent." },
      { status: 404 },
    );
  }

  const updatedAutomation = await prisma.agentAutomation.update({
    where: {
      id: automation.id,
    },
    data: {
      isEnabled:
        typeof body.isEnabled === "boolean"
          ? body.isEnabled
          : automation.isEnabled,
      summary:
        typeof body.summary === "string"
          ? body.summary.trim() || null
          : automation.summary,
    },
  });

  return NextResponse.json({ automation: updatedAutomation });
}
