import type { Prisma } from "@/app/generated/prisma/client";
import { type WidgetChatbot, decideWidgetReply, isFallbackReplyDue } from "./chatbot-widget";
import { generateSessionReply, loadAgentForReplies } from "./conversation-runtime";
import { checkInboundEscalation } from "./escalation";
import type { ReplyStream } from "./llm-stream";
import { createNotification } from "./notifications";
import { prisma } from "./prisma";
import { appendSessionMessage, recordSessionEvent } from "./session-lifecycle";
import { isTrustedUploadUrl } from "./uploads";

export type WidgetAttachment = {
  url: string;
  name: string;
  mimeType: string;
  size: number;
};

export const MAX_WIDGET_MESSAGE_LENGTH = 2000;

export function parseWidgetAttachments(value: unknown): WidgetAttachment[] | null {
  if (typeof value === "undefined" || value === null) {
    return [];
  }

  if (!Array.isArray(value) || value.length > 3) {
    return null;
  }

  const attachments: WidgetAttachment[] = [];

  for (const item of value) {
    const candidate = item as Partial<WidgetAttachment>;

    if (
      typeof candidate?.url !== "string" ||
      !isTrustedUploadUrl(candidate.url) ||
      typeof candidate.name !== "string" ||
      typeof candidate.mimeType !== "string"
    ) {
      return null;
    }

    attachments.push({
      url: candidate.url,
      name: candidate.name.slice(0, 120),
      mimeType: candidate.mimeType.slice(0, 120),
      size: typeof candidate.size === "number" ? candidate.size : 0,
    });
  }

  return attachments;
}

export function serializeWidgetMessage(message: {
  id: string;
  sender: string;
  content: string;
  attachments: Prisma.JsonValue | null;
  authorName: string | null;
  createdAt: Date;
  feedback?: { rating: number } | null;
}) {
  return {
    id: message.id,
    sender: message.sender,
    content: message.content,
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    authorName: message.authorName,
    createdAt: message.createdAt.toISOString(),
    // Module 6 FE-3: the visitor's own 👍/👎 on this AI reply.
    ...(message.feedback !== undefined ? { rating: message.feedback?.rating ?? null } : {}),
  };
}

export async function replyWithAgent(
  chatbot: WidgetChatbot,
  sessionId: string,
  stream?: ReplyStream,
  channel: "WEB_WIDGET" | "VOICE" = "WEB_WIDGET",
) {
  const agent = await loadAgentForReplies(chatbot.agentId);

  if (!agent) {
    return null;
  }

  const result = await generateSessionReply({
    sessionId,
    workspaceId: chatbot.workspaceId,
    agent,
    channel,
    extraSystemPrompt: chatbot.additionalPrompt,
    logSummary: channel === "VOICE" ? `Voice call reply generated for ${chatbot.name}.` : `Widget reply generated for ${chatbot.name}.`,
    stream,
  });

  return result ? { message: result.message, firstTokenMs: result.firstTokenMs } : null;
}

declare global {
  var widgetFallbackLocks: Set<string> | undefined;
}

const fallbackLocks = global.widgetFallbackLocks ?? new Set<string>();
global.widgetFallbackLocks = fallbackLocks;

/**
 * FALLBACK reply mode (SRS: "if no human reply within X seconds, trigger AI"): checked
 * whenever the widget polls or its live stream ticks.
 */
export async function runFallbackIfDue(chatbot: WidgetChatbot, sessionId: string) {
  if (fallbackLocks.has(sessionId) || !(await isFallbackReplyDue(chatbot, sessionId))) {
    return;
  }

  fallbackLocks.add(sessionId);

  try {
    const message = (await replyWithAgent(chatbot, sessionId))?.message;

    if (message) {
      await recordSessionEvent({
        workspaceId: chatbot.workspaceId,
        sessionId,
        type: "AI_FALLBACK_REPLY",
        detail: `No team reply within ${chatbot.fallbackDelaySeconds}s, so the AI answered.`,
      });
    }
  } finally {
    fallbackLocks.delete(sessionId);
  }
}

type ReplyMessage = Awaited<ReturnType<typeof appendSessionMessage>>;

/**
 * Answers the visitor's latest message according to the chatbot's reply mode (SRS
 * FR-14.2 – FR-14.8): the AI replies now, the visitor is told a human will answer,
 * or a system notice explains why the AI stays quiet (AI reply limit reached).
 * Used after a new message and after the lead form is submitted or skipped.
 */
export async function respondToVisitor(
  chatbot: WidgetChatbot,
  sessionId: string,
  customerText: string,
  stream?: ReplyStream,
) {
  const session = await prisma.chatSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      channel: true,
      aiMessageCount: true,
      contactId: true,
      customerName: true,
      customerEmail: true,
    },
  });
  const messages: ReplyMessage[] = [];

  // Module 9 FE-1/FE-3: an upset customer, a request for a person or a sensitive topic
  // goes to the team before the AI answers; the customer is told a person will reply.
  // Latency: the reply-mode decision only reads, so it is worked out at the same time
  // and simply ignored when the conversation is escalated.
  const [trigger, decision] = await Promise.all([
    checkInboundEscalation({ workspaceId: chatbot.workspaceId, sessionId, text: customerText }),
    decideWidgetReply({ chatbot, sessionId, sessionStatus: session.status }),
  ]);

  if (trigger.escalated) {
    if (trigger.noticeMessage) {
      messages.push(trigger.noticeMessage);
    }

    return { messages, waitingForHuman: true, firstTokenMs: null };
  }

  if (decision.action === "AI_NOW") {
    const reply = await replyWithAgent(chatbot, sessionId, stream, session.channel === "VOICE" ? "VOICE" : "WEB_WIDGET");

    if (reply) {
      messages.push(reply.message);
    }

    return { messages, waitingForHuman: false, firstTokenMs: reply?.firstTokenMs ?? null };
  }

  const notice = decision.action === "SYSTEM" ? decision.content : decision.notice;

  if (decision.action === "SYSTEM" && session.aiMessageCount >= chatbot.maxAiMessages) {
    await recordSessionEvent({
      workspaceId: chatbot.workspaceId,
      sessionId,
      contactId: session.contactId,
      type: "AI_LIMIT_REACHED",
      detail: `AI reply limit (${chatbot.maxAiMessages}) reached; conversation is now human-only.`,
    });
  }

  if (notice && decision.action === "WAIT_FOR_HUMAN") {
    await createNotification({
      workspaceId: chatbot.workspaceId,
      type: "CHAT_WAITING",
      severity: "WARNING",
      title: `${session.customerName || session.customerEmail || "A visitor"} is waiting for a team reply`,
      body: customerText.slice(0, 160),
      link: "/dashboard/chats",
      dedupeMinutes: 10,
    });
  }

  if (notice) {
    messages.push(
      await appendSessionMessage({
        sessionId,
        workspaceId: chatbot.workspaceId,
        sender: "SYSTEM",
        content: notice,
      }),
    );
  }

  return { messages, waitingForHuman: decision.action === "WAIT_FOR_HUMAN", firstTokenMs: null };
}
