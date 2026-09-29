import type { Prisma } from "@/app/generated/prisma/client";
import { type WidgetChatbot, isFallbackReplyDue } from "./chatbot-widget";
import { generateSessionReply, loadAgentForReplies } from "./conversation-runtime";
import { recordSessionEvent } from "./session-lifecycle";
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
}) {
  return {
    id: message.id,
    sender: message.sender,
    content: message.content,
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    authorName: message.authorName,
    createdAt: message.createdAt.toISOString(),
  };
}

export async function replyWithAgent(chatbot: WidgetChatbot, sessionId: string) {
  const agent = await loadAgentForReplies(chatbot.agentId);

  if (!agent) {
    return null;
  }

  const result = await generateSessionReply({
    sessionId,
    workspaceId: chatbot.workspaceId,
    agent,
    channel: "WEB_WIDGET",
    extraSystemPrompt: chatbot.additionalPrompt,
    logSummary: `Widget reply generated for ${chatbot.name}.`,
  });

  return result?.message ?? null;
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
    const message = await replyWithAgent(chatbot, sessionId);

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
