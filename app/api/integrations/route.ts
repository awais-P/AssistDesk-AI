import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import {
  integrationInclude,
  serializeIntegration,
} from "@/src/lib/integrations/serialize";
import {
  mergeIntegrationConfig,
  missingSecretFields,
  readIntegrationConfig,
} from "@/src/lib/integrations/config";
import { testSlackConnection } from "@/src/lib/integrations/slack";
import { testWhatsAppConnection } from "@/src/lib/integrations/whatsapp";
import { generateToken } from "@/src/lib/secrets";

type IntegrationTypeValue = "EMAIL" | "WHATSAPP" | "SLACK" | "VOICE";

type IntegrationPayload = {
  id?: string;
  type?: string;
  name?: string;
  provider?: string;
  supportAddress?: string | null;
  forwardingAddress?: string | null;
  inboxId?: string | null;
  agentId?: string | null;
  isActive?: boolean;
  config?: Record<string, unknown> | null;
};

const supportedTypes = new Set<IntegrationTypeValue>(["EMAIL", "WHATSAPP", "SLACK"]);

async function testConnection(
  type: IntegrationTypeValue,
  config: Record<string, unknown>,
): Promise<{
  status: "CONNECTED" | "ERROR";
  statusMessage: string;
  externalId: string | null;
  discovered: Record<string, string>;
}> {
  const plain = readIntegrationConfig(type, config as Prisma.JsonValue);
  const missing = missingSecretFields(type, plain);

  if (missing.length > 0) {
    return {
      status: "ERROR",
      statusMessage: `Missing ${missing.join(", ")}.`,
      externalId: null,
      discovered: {},
    };
  }

  try {
    if (type === "SLACK") {
      const result = await testSlackConnection(plain.botToken);

      return {
        status: "CONNECTED",
        statusMessage: `Connected to Slack workspace ${result.teamName}.`,
        externalId: result.teamId,
        discovered: { botUserId: result.botUserId, teamName: result.teamName },
      };
    }

    if (type === "WHATSAPP") {
      if (!plain.phoneNumberId) {
        return {
          status: "ERROR",
          statusMessage: "Missing phoneNumberId.",
          externalId: null,
          discovered: {},
        };
      }

      const result = await testWhatsAppConnection(plain.accessToken, plain.phoneNumberId);

      return {
        status: "CONNECTED",
        statusMessage: `Connected to WhatsApp number ${result.displayPhoneNumber ?? plain.phoneNumberId}.`,
        externalId: plain.phoneNumberId,
        discovered: {
          ...(result.displayPhoneNumber ? { displayPhoneNumber: result.displayPhoneNumber } : {}),
          ...(result.verifiedName ? { verifiedName: result.verifiedName } : {}),
        },
      };
    }
  } catch (error) {
    return {
      status: "ERROR",
      statusMessage:
        error instanceof Error
          ? `${error.message}. Check the token and try again.`
          : "Connection test failed.",
      externalId: null,
      discovered: {},
    };
  }

  return { status: "CONNECTED", statusMessage: "Ready to receive email.", externalId: null, discovered: {} };
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
    include: integrationInclude,
    orderBy: {
      createdAt: "asc",
    },
  });

  return NextResponse.json({ integrations: integrations.map(serializeIntegration) });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as IntegrationPayload;
  const type = (body.type || "EMAIL") as IntegrationTypeValue;
  const name = body.name?.trim();

  if (!supportedTypes.has(type)) {
    return NextResponse.json(
      { error: "Selected integration type is not supported yet." },
      { status: 400 },
    );
  }

  if (!name) {
    return NextResponse.json(
      { error: "Integration name is required." },
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

  if (type !== "EMAIL" && !body.agentId) {
    return NextResponse.json(
      { error: "Choose the AI agent that should answer this channel." },
      { status: 400 },
    );
  }

  const existing = body.id
    ? await prisma.integration.findFirst({
        where: {
          id: body.id,
          workspaceId: session.user.workspaceId,
        },
        select: {
          id: true,
          type: true,
          webhookSecret: true,
          config: true,
        },
      })
    : null;

  if (body.id && !existing) {
    return NextResponse.json(
      { error: "Integration not found." },
      { status: 404 },
    );
  }

  if (existing && existing.type !== type) {
    return NextResponse.json(
      { error: "The integration type cannot be changed. Create a new integration instead." },
      { status: 400 },
    );
  }

  const mergedConfig = mergeIntegrationConfig(type, body.config, existing?.config);
  const connection = await testConnection(type, mergedConfig);

  const data = {
    workspaceId: session.user.workspaceId,
    type,
    name: name.slice(0, 80),
    provider: body.provider?.trim() || (type === "SLACK" ? "Slack" : type === "WHATSAPP" ? "Meta Cloud API" : "Custom"),
    status: connection.status,
    statusMessage: connection.statusMessage,
    externalId: connection.externalId,
    supportAddress:
      type === "EMAIL" ? body.supportAddress?.trim().toLowerCase() || null : null,
    forwardingAddress:
      type === "EMAIL" ? body.forwardingAddress?.trim().toLowerCase() || null : null,
    inboxId: body.inboxId || null,
    agentId: body.agentId || null,
    isActive: body.isActive ?? true,
    config: { ...mergedConfig, ...connection.discovered } as Prisma.InputJsonValue,
    webhookSecret: existing?.webhookSecret || generateToken(24),
  };

  try {
    const integration = existing
      ? await prisma.integration.update({
          where: { id: existing.id },
          data,
          include: integrationInclude,
        })
      : await prisma.integration.create({
          data,
          include: integrationInclude,
        });

    if (integration.agentId && integration.inboxId && type === "EMAIL") {
      await prisma.aIAgent.update({
        where: {
          id: integration.agentId,
        },
        data: {
          inboxId: integration.inboxId,
        },
      });
    }

    return NextResponse.json({ integration: serializeIntegration(integration) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        {
          error:
            type === "SLACK"
              ? "This Slack workspace is already connected to AssistDesk."
              : "This WhatsApp number is already connected to AssistDesk.",
        },
        { status: 409 },
      );
    }

    throw error;
  }
}
