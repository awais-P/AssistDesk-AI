import { Prisma } from "@/app/generated/prisma/client";
import { generateSessionReply, loadAgentForReplies } from "../conversation-runtime";
import { prisma } from "../prisma";

type InboundChannel = "SLACK" | "WHATSAPP";

type InboundIntegration = {
  id: string;
  workspaceId: string;
  agentId: string | null;
  name: string;
};

/**
 * Stores an inbound Slack/WhatsApp message in the matching chat session (one session
 * per conversation) and sends the AI agent's reply back through `deliver`.
 */
export async function handleChannelInbound({
  integration,
  channel,
  conversationKey,
  externalMessageId,
  customerName,
  customerPhone,
  text,
  deliver,
}: {
  integration: InboundIntegration;
  channel: InboundChannel;
  conversationKey: string;
  externalMessageId: string;
  customerName: string | null;
  customerPhone?: string | null;
  text: string;
  deliver: (reply: string) => Promise<void>;
}) {
  let session = await prisma.chatSession.findFirst({
    where: {
      integrationId: integration.id,
      externalId: conversationKey,
      status: { not: "CLOSED" },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!session) {
    session = await prisma.chatSession.create({
      data: {
        workspaceId: integration.workspaceId,
        integrationId: integration.id,
        externalId: conversationKey,
        channel,
        status: "ACTIVE",
        customerName,
        customerPhone: customerPhone ?? null,
      },
    });
  } else if (customerName && session.customerName !== customerName) {
    session = await prisma.chatSession.update({
      where: { id: session.id },
      data: { customerName },
    });
  }

  try {
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        sender: "USER",
        content: text.slice(0, 4000),
        authorName: customerName,
        externalId: externalMessageId,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Provider retried a message we already handled.
      return { status: "duplicate" as const };
    }

    throw error;
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: { lastSyncedAt: new Date() },
    select: { id: true },
  });

  if (session.status === "ESCALATED") {
    return { status: "human" as const };
  }

  if (!integration.agentId) {
    return { status: "no-agent" as const };
  }

  const agent = await loadAgentForReplies(integration.agentId);

  if (!agent || agent.status !== "ACTIVE") {
    return { status: "agent-inactive" as const };
  }

  const result = await generateSessionReply({
    sessionId: session.id,
    workspaceId: integration.workspaceId,
    agent,
    channel,
    logAction: `${channel}_REPLY`,
    logSummary: `${channel === "SLACK" ? "Slack" : "WhatsApp"} reply generated via ${integration.name}.`,
  });

  if (!result) {
    return { status: "no-message" as const };
  }

  try {
    await deliver(result.message.content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${channel.toLowerCase()}] Failed to deliver reply: ${message}`);

    await prisma.automationLog.create({
      data: {
        workspaceId: integration.workspaceId,
        agentId: agent.id,
        action: `${channel}_DELIVERY`,
        status: "FAILED",
        summary: `Reply could not be delivered: ${message}`.slice(0, 500),
      },
    });

    return { status: "delivery-failed" as const };
  }

  return { status: "replied" as const };
}
