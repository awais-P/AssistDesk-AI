import { createNotification } from "../notifications";
import { Prisma } from "@/app/generated/prisma/client";
import { type ContactIdentity, resolveContact } from "../contacts";
import { generateSessionReply, loadAgentForReplies } from "../conversation-runtime";
import { prisma } from "../prisma";
import { RATE_LIMITS, consumeRateLimit } from "../rate-limit";
import {
  appendSessionMessage,
  getOrStartChannelSession,
  recordSessionEvent,
} from "../session-lifecycle";

type InboundChannel = "SLACK" | "WHATSAPP";

type InboundIntegration = {
  id: string;
  workspaceId: string;
  agentId: string | null;
  name: string;
};

const RATE_LIMIT_NOTICE =
  "You're sending messages very quickly. Please wait a minute and try again.";

/**
 * Handles one inbound Slack/WhatsApp message (Module 5 on persistent channels):
 * identifies the customer, continues or starts the conversation session (applying
 * the channel's idle policy), rate-limits it, stores the message and replies with
 * the AI agent, including memory from the customer's other channels.
 */
export async function handleChannelInbound({
  integration,
  channel,
  conversationKey,
  externalMessageId,
  identity,
  customerName,
  customerPhone,
  text,
  deliver,
}: {
  integration: InboundIntegration;
  channel: InboundChannel;
  conversationKey: string;
  externalMessageId: string;
  identity: ContactIdentity;
  customerName: string | null;
  customerPhone?: string | null;
  text: string;
  deliver: (reply: string) => Promise<void>;
}) {
  // Provider retries: skip before touching sessions if we already stored this message.
  const duplicate = await prisma.chatMessage.findUnique({
    where: { externalId: externalMessageId },
    select: { id: true },
  });

  if (duplicate) {
    return { status: "duplicate" as const };
  }

  const contact = await resolveContact(
    integration.workspaceId,
    { ...identity, name: identity.name ?? customerName },
    channel,
  );
  const { session } = await getOrStartChannelSession({
    workspaceId: integration.workspaceId,
    channel,
    integrationId: integration.id,
    externalId: conversationKey,
    contactId: contact?.id ?? null,
    customerName,
    customerPhone: customerPhone ?? null,
  });

  if (contact && session.contactId !== contact.id) {
    await prisma.chatSession.update({
      where: { id: session.id },
      data: { contactId: contact.id, customerName: customerName ?? session.customerName },
      select: { id: true },
    });
  }

  const limit = await consumeRateLimit(
    `channel:${integration.id}:${conversationKey}`,
    RATE_LIMITS.channelMessagePerConversation,
  );

  if (!limit.allowed) {
    await recordSessionEvent({
      workspaceId: integration.workspaceId,
      sessionId: session.id,
      contactId: contact?.id ?? null,
      type: "RATE_LIMITED",
      detail: `More than ${RATE_LIMITS.channelMessagePerConversation.limit} ${channel === "SLACK" ? "Slack" : "WhatsApp"} messages in a minute.`,
      metadata: { scope: "channel-conversation", channel },
    });

    // Tell the customer once per window instead of silently dropping messages.
    if (limit.count === limit.limit + 1) {
      await deliver(RATE_LIMIT_NOTICE).catch(() => undefined);
    }

    return { status: "rate-limited" as const };
  }

  try {
    await appendSessionMessage({
      sessionId: session.id,
      workspaceId: integration.workspaceId,
      sender: "USER",
      content: text.slice(0, 4000),
      authorName: customerName,
      externalId: externalMessageId,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
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

    await createNotification({
      workspaceId: integration.workspaceId,
      type: "CHANNEL_DELIVERY_FAILED",
      severity: "ERROR",
      title: `${channel === "SLACK" ? "Slack" : "WhatsApp"} reply could not be delivered`,
      body: `${integration.name}: ${message}`.slice(0, 300),
      link: "/dashboard/integrations",
      dedupeMinutes: 30,
    });

    return { status: "delivery-failed" as const };
  }

  return { status: "replied" as const };
}
