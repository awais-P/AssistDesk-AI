import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import {
  defaultAgentSystemPrompt,
  agentModelOptions,
} from "@/src/lib/agent-config";
import { prisma } from "@/src/lib/prisma";

type AgentPayload = {
  id?: string;
  name?: string;
  inboxId?: string | null;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  confidenceThreshold?: number;
  temperature?: number;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
};

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const agents = await prisma.aIAgent.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    include: {
      inbox: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return NextResponse.json({ agents });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as AgentPayload;
  const name = body.name?.trim();

  if (!name) {
    return NextResponse.json(
      { error: "Agent name is required." },
      { status: 400 },
    );
  }

  if (body.inboxId) {
    const inbox = await prisma.inbox.findFirst({
      where: {
        id: body.inboxId,
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!inbox) {
      return NextResponse.json(
        { error: "Selected inbox was not found for this workspace." },
        { status: 404 },
      );
    }
  }

  const data = {
    workspaceId: session.user.workspaceId,
    inboxId: body.inboxId || null,
    name,
    provider: body.provider?.trim() || "Default",
    model: body.model?.trim() || agentModelOptions[0],
    systemPrompt: body.systemPrompt?.trim() || defaultAgentSystemPrompt,
    confidenceThreshold:
      typeof body.confidenceThreshold === "number"
        ? body.confidenceThreshold
        : 0.5,
    temperature:
      typeof body.temperature === "number" ? body.temperature : 0.7,
    status: body.status || ("ACTIVE" as const),
  };

  let agent;

  if (body.id) {
    const existingAgent = await prisma.aIAgent.findFirst({
      where: {
        id: body.id,
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!existingAgent) {
      return NextResponse.json(
        { error: "AI agent not found in this workspace." },
        { status: 404 },
      );
    }

    agent = await prisma.aIAgent.update({
      where: {
        id: body.id,
      },
      data,
      include: {
        inbox: true,
      },
    });
  } else {
    agent = await prisma.aIAgent.create({
      data,
      include: {
        inbox: true,
      },
    });
  }

  return NextResponse.json({ agent });
}
