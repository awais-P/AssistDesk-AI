import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import {
  IntegrationStatus,
  IntegrationType,
} from "@/app/generated/prisma/enums";

type IntegrationPayload = {
  id?: string;
  type?: keyof typeof IntegrationType;
  name?: string;
  provider?: string;
  status?: keyof typeof IntegrationStatus;
  supportAddress?: string | null;
  forwardingAddress?: string | null;
  inboxId?: string | null;
  agentId?: string | null;
  isActive?: boolean;
  config?: Record<string, unknown> | null;
};

function generateWebhookSecret() {
  return crypto.randomUUID().replaceAll("-", "");
}

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const integrations = await prisma.integration.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    include: {
      inbox: true,
      agent: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return NextResponse.json({ integrations });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as IntegrationPayload;
  const type = body.type || "EMAIL";
  const name = body.name?.trim();
  const provider = body.provider?.trim() || "Custom";

  if (!name) {
    return NextResponse.json(
      { error: "Integration name is required." },
      { status: 400 },
    );
  }

  if (!(type in IntegrationType)) {
    return NextResponse.json(
      { error: "Selected integration type is not supported." },
      { status: 400 },
    );
  }

  if (body.inboxId) {
    const inbox = await prisma.inbox.findFirst({
      where: {
        id: body.inboxId,
        workspaceId: session.user.workspaceId,
      },
      select: { id: true },
    });

    if (!inbox) {
      return NextResponse.json(
        { error: "Selected inbox was not found for this workspace." },
        { status: 404 },
      );
    }
  }

  if (body.agentId) {
    const agent = await prisma.aIAgent.findFirst({
      where: {
        id: body.agentId,
        workspaceId: session.user.workspaceId,
      },
      select: { id: true },
    });

    if (!agent) {
      return NextResponse.json(
        { error: "Selected AI agent was not found for this workspace." },
        { status: 404 },
      );
    }
  }

  const configValue = (body.config ?? {}) as Prisma.InputJsonValue;

  const data = {
    workspaceId: session.user.workspaceId,
    type,
    name,
    provider,
    status:
      body.status && body.status in IntegrationStatus
        ? body.status
        : ("CONNECTED" as const),
    supportAddress: body.supportAddress?.trim().toLowerCase() || null,
    forwardingAddress: body.forwardingAddress?.trim().toLowerCase() || null,
    inboxId: body.inboxId || null,
    agentId: body.agentId || null,
    isActive: body.isActive ?? true,
    config: configValue,
    webhookSecret: generateWebhookSecret(),
  };

  let integration;

  if (body.id) {
    const existing = await prisma.integration.findFirst({
      where: {
        id: body.id,
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
        webhookSecret: true,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Integration not found." },
        { status: 404 },
      );
    }

    integration = await prisma.integration.update({
      where: {
        id: body.id,
      },
      data: {
        ...data,
        webhookSecret: existing.webhookSecret,
      },
      include: {
        inbox: true,
        agent: true,
      },
    });
  } else {
    integration = await prisma.integration.create({
      data,
      include: {
        inbox: true,
        agent: true,
      },
    });
  }

  if (integration.agentId && integration.inboxId) {
    await prisma.aIAgent.update({
      where: {
        id: integration.agentId,
      },
      data: {
        inboxId: integration.inboxId,
      },
    });
  }

  return NextResponse.json({ integration });
}
