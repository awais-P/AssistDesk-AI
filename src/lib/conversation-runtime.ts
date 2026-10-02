import { hydrateKnowledgeSources } from "./knowledge-runtime";
import {
  type ConversationTurn,
  type ReplyChannel,
  generateAgentReply,
  toRuntimeAgent,
} from "./llm-runtime";
import { prisma } from "./prisma";
import { appendSessionMessage, recordSessionEvent } from "./session-lifecycle";
import { HISTORY_WINDOW, buildCustomerContext, scheduleMemoryRefresh } from "./session-memory";

const HISTORY_MESSAGE_LIMIT = HISTORY_WINDOW;

type AttachmentSummary = { name?: string; mimeType?: string };

function describeAttachments(attachments: unknown) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return "";
  }

  const names = (attachments as AttachmentSummary[])
    .map((attachment) => attachment?.name)
    .filter(Boolean)
    .join(", ");

  return names ? `\n[Customer attached: ${names}]` : "";
}

/**
 * Loads an agent (with its encrypted key and knowledge) for answering a chat.
 */
export async function loadAgentForReplies(agentId: string) {
  return prisma.aIAgent.findUnique({
    where: { id: agentId },
    omit: { apiKey: false },
    include: {
      knowledgeSources: {
        where: { status: { not: "DELETED" } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          sourceUrl: true,
          rawText: true,
        },
      },
    },
  });
}

export type ReplyAgent = NonNullable<Awaited<ReturnType<typeof loadAgentForReplies>>>;

/**
 * Generates and stores the AI reply for the latest customer message of a chat
 * session, using the recent conversation as context.
 */
export async function generateSessionReply({
  sessionId,
  workspaceId,
  agent,
  channel,
  extraSystemPrompt,
  logAction = "CHATBOT_REPLY",
  logSummary,
}: {
  sessionId: string;
  workspaceId: string;
  agent: ReplyAgent;
  channel: ReplyChannel;
  extraSystemPrompt?: string | null;
  logAction?: string;
  logSummary: string;
}) {
  const recentMessages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_MESSAGE_LIMIT + 1,
    select: { sender: true, content: true, attachments: true },
  });
  const chronological = recentMessages.reverse();
  const latestCustomerIndex = chronological.map((message) => message.sender).lastIndexOf("USER");

  if (latestCustomerIndex === -1) {
    return null;
  }

  const latest = chronological[latestCustomerIndex];
  const history: ConversationTurn[] = chronological
    .slice(0, latestCustomerIndex)
    .filter((message) => message.sender !== "SYSTEM")
    .map((message) => ({
      role: message.sender === "USER" ? "user" : "assistant",
      content: `${message.content}${describeAttachments(message.attachments)}`,
    }));

  const [sources, session, customerContext] = await Promise.all([
    hydrateKnowledgeSources(agent.knowledgeSources),
    prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        summary: true,
        summarizedMessageCount: true,
        messageCount: true,
        contactId: true,
        previousSessionId: true,
        chatbotId: true,
      },
    }),
    buildCustomerContext(sessionId),
  ]);
  // The rolling summary only covers messages older than the history window.
  const conversationSummary =
    session?.summary && session.messageCount > HISTORY_WINDOW ? session.summary : null;
  const response = await generateAgentReply({
    agent: toRuntimeAgent(agent, extraSystemPrompt),
    question: `${latest.content}${describeAttachments(latest.attachments)}`,
    sources,
    history,
    channel,
    memory: { customerContext: customerContext.text, conversationSummary },
  });

  const message = await appendSessionMessage({
    sessionId,
    workspaceId,
    sender: "AI",
    content: response.reply,
    authorName: agent.name,
  });

  // First reply that used memory from other sessions: record the carry-over (FE-2).
  if (customerContext.carriedSessions.length > 0) {
    const alreadyRecorded = await prisma.sessionEvent.count({
      where: { sessionId, type: "CONTEXT_CARRIED" },
    });

    if (alreadyRecorded === 0) {
      await recordSessionEvent({
        workspaceId,
        sessionId,
        contactId: session?.contactId ?? null,
        type: "CONTEXT_CARRIED",
        detail: `AI received context from ${customerContext.carriedSessions.length} earlier conversation(s): ${[...new Set(customerContext.carriedSessions.map((item) => item.channel.replace("_", " ").toLowerCase()))].join(", ")}.`,
        metadata: { sessionIds: customerContext.carriedSessions.map((item) => item.id) },
      });
    }
  }

  // Long conversation: condense older messages in the background (FE-3).
  if ((session?.messageCount ?? 0) + 1 > HISTORY_WINDOW) {
    scheduleMemoryRefresh({ sessionId, contactId: session?.contactId ?? null });
  }

  await prisma.$transaction([
    // Module 4 analytics store: the question, response time and how it was answered.
    prisma.aiInteraction.create({
      data: {
        workspaceId,
        agentId: agent.id,
        chatbotId: session?.chatbotId ?? null,
        sessionId,
        messageId: message.id,
        channel: channel === "PLAYGROUND" ? "WEB_WIDGET" : channel,
        question: latest.content.slice(0, 1000),
        latencyMs: Math.max(0, Math.round(response.latencyMs)),
        tokens: response.tokens,
        model: response.modelUsed,
        provider: response.providerUsed,
        confidence: response.confidence,
        grounded: response.usedSourceIds.length > 0,
        usedFallback: response.usedFallback,
        sourceIds: response.usedSourceIds,
      },
    }),
    prisma.automationLog.create({
      data: {
        workspaceId,
        agentId: agent.id,
        action: logAction,
        status: response.usedFallback ? "FALLBACK" : "SUCCESS",
        model: response.modelUsed,
        tokens: response.tokens,
        durationMs: response.latencyMs,
        summary: response.usedFallback
          ? `${logSummary} Knowledge-base fallback used: ${response.errorMessage ?? "no AI reply"}`
          : logSummary,
      },
    }),
  ]);

  return { message, response, usedMemory: Boolean(customerContext.text) };
}
