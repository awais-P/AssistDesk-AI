import { runAgentReply } from "./agent-engine/run-agent";
import { AI_LIMIT_NOTICE, aiReplyAllowed } from "./billing";
import { safeTimeZone } from "./analytics-math";
import { hydrateKnowledgeSources } from "./knowledge-runtime";
import {
  type ConversationTurn,
  type ReplyChannel,
  generateAgentReply,
  toRuntimeAgent,
} from "./llm-runtime";
import { type ReplyStream, measuredStream } from "./llm-stream";
import { prisma } from "./prisma";
import { appendSessionMessage, recordSessionEvent } from "./session-lifecycle";
import { HISTORY_WINDOW, buildCustomerContext, isVerifiedIdentity, scheduleMemoryRefresh } from "./session-memory";
import { loadAgentToolset } from "./tools/registry";

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
  stream: rawStream,
}: {
  sessionId: string;
  workspaceId: string;
  agent: ReplyAgent;
  channel: ReplyChannel;
  extraSystemPrompt?: string | null;
  logAction?: string;
  logSummary: string;
  /** Receives the reply while it is written (website chat); the stored message is the same text. */
  stream?: ReplyStream;
}) {
  const startedAt = Date.now();
  const measured = measuredStream(rawStream, startedAt);
  const stream = measured.stream;
  // Latency: everything the model needs is loaded at the same time, not one after another.
  const [recentMessages, allowed, sources, session, customerContext, toolset] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_MESSAGE_LIMIT + 1,
      select: { sender: true, content: true, attachments: true },
    }),
    // Module 3: the plan's monthly AI replies.
    aiReplyAllowed(workspaceId),
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
        channel: true,
        visitorId: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        contact: { select: { visitorId: true } },
        workspace: { select: { settings: { select: { timezone: true } } } },
      },
    }),
    buildCustomerContext(sessionId),
    channel === "PLAYGROUND" ? { tools: [], settings: null } : loadAgentToolset(workspaceId, agent.id),
  ]);
  const chronological = recentMessages.reverse();
  const latestCustomerIndex = chronological.map((message) => message.sender).lastIndexOf("USER");

  if (latestCustomerIndex === -1) {
    return null;
  }

  if (!allowed) {
    const noticed = await prisma.chatMessage.count({ where: { sessionId, sender: "SYSTEM", content: AI_LIMIT_NOTICE } });
    if (noticed === 0) {
      await appendSessionMessage({ sessionId, workspaceId, sender: "SYSTEM", content: AI_LIMIT_NOTICE });
    }
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

  // The rolling summary only covers messages older than the history window.
  const conversationSummary =
    session?.summary && session.messageCount > HISTORY_WINDOW ? session.summary : null;
  const question = `${latest.content}${describeAttachments(latest.attachments)}`;
  const memory = { customerContext: customerContext.text, conversationSummary };
  const runtimeAgent = toRuntimeAgent(agent, extraSystemPrompt);
  // Module 2: agents with tools reason and act through the LangGraph engine.
  const response =
    toolset.tools.length > 0 && toolset.settings && session
      ? await runAgentReply({
          agent: { ...runtimeAgent, id: agent.id },
          workspaceId,
          channel,
          source: "CHAT",
          question,
          history,
          sources,
          memory,
          tools: toolset.tools,
          settings: toolset.settings,
          ctx: {
            workspaceId,
            sessionId,
            ticketId: null,
            contactId: session.contactId,
            channel: session.channel,
            verifiedIdentity: isVerifiedIdentity(session),
            customer: { name: session.customerName, email: session.customerEmail, phone: session.customerPhone },
            timeZone: safeTimeZone(session.workspace.settings?.timezone ?? "UTC"),
            dryRun: false,
            triggeredBy: "MODEL",
          },
          stream,
        })
      : await generateAgentReply({ agent: runtimeAgent, question, sources, history, channel, memory, stream });
  const firstTokenMs = measured.firstTokenMs;
  // Response time as the customer feels it: from here (loading included) to the full reply.
  const totalMs = Date.now() - startedAt;

  if (firstTokenMs !== null) {
    console.info(`[latency] ${channel} reply: first word after ${firstTokenMs} ms, complete after ${totalMs} ms (${response.modelUsed}).`);
  }

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
        latencyMs: Math.max(0, totalMs),
        firstTokenMs,
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
        durationMs: totalMs,
        summary: response.usedFallback
          ? `${logSummary} Knowledge-base fallback used: ${response.errorMessage ?? "no AI reply"}`
          : logSummary,
      },
    }),
  ]);

  return { message, response, usedMemory: Boolean(customerContext.text), firstTokenMs };
}
