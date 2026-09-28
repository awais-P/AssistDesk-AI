import { hydrateKnowledgeSources } from "./knowledge-runtime";
import {
  type ConversationTurn,
  type ReplyChannel,
  generateAgentReply,
  toRuntimeAgent,
} from "./llm-runtime";
import { prisma } from "./prisma";

const HISTORY_MESSAGE_LIMIT = 12;

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

  const sources = await hydrateKnowledgeSources(agent.knowledgeSources);
  const response = await generateAgentReply({
    agent: toRuntimeAgent(agent, extraSystemPrompt),
    question: `${latest.content}${describeAttachments(latest.attachments)}`,
    sources,
    history,
    channel,
  });

  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        sessionId,
        sender: "AI",
        content: response.reply,
        authorName: agent.name,
      },
    }),
    prisma.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
      select: { id: true },
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

  return { message, response };
}
