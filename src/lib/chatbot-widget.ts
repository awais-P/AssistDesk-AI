import { prisma } from "./prisma";
import { isWorkspaceOnline } from "./presence";
import { PREVIEW_HOST, WIDGET_TOKEN_HEADER, verifyWidgetToken } from "./widget-token";

export function normalizeHost(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

export function parseHostFromUrl(value: string | null) {
  if (!value) {
    return "";
  }

  try {
    return normalizeHost(new URL(value).host);
  } catch {
    return "";
  }
}

export function doesHostMatchAllowedDomain(host: string, allowedDomain: string) {
  const normalizedHost = normalizeHost(host);
  const normalizedAllowedDomain = normalizeHost(allowedDomain);

  if (!normalizedHost || !normalizedAllowedDomain) {
    return false;
  }

  return (
    normalizedHost === normalizedAllowedDomain ||
    normalizedHost.endsWith(`.${normalizedAllowedDomain}`)
  );
}

export function isAllowedWidgetHost(host: string, allowedDomains: string[]) {
  return allowedDomains.some((allowedDomain) =>
    doesHostMatchAllowedDomain(host, allowedDomain),
  );
}

export async function getWidgetChatbot(widgetId: string) {
  return prisma.chatbot.findUnique({
    where: {
      widgetId,
    },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
    },
  });
}

export type WidgetChatbot = NonNullable<Awaited<ReturnType<typeof getWidgetChatbot>>>;

type WidgetAccess =
  | { ok: true; chatbot: WidgetChatbot; host: string; isPreview: boolean }
  | { ok: false; status: number; error: string };

/**
 * Authorises a public widget API call. The iframe page verifies the embedding site
 * from the browser's Referer and issues a signed token; every API call must carry it,
 * and the host is re-checked against the chatbot's current allowed domains.
 */
export async function authorizeWidgetRequest(
  request: Request,
  widgetId: string,
): Promise<WidgetAccess> {
  const chatbot = await getWidgetChatbot(widgetId);

  if (!chatbot) {
    return { ok: false, status: 404, error: "Widget not found." };
  }

  const token =
    request.headers.get(WIDGET_TOKEN_HEADER) || new URL(request.url).searchParams.get("token");
  const claims = verifyWidgetToken(token, widgetId);

  if (!claims) {
    return {
      ok: false,
      status: 401,
      error: "This chat session has expired. Please reload the page.",
    };
  }

  if (!claims.isPreview && !isAllowedWidgetHost(claims.host, chatbot.allowedDomains)) {
    return {
      ok: false,
      status: 403,
      error: "This website is not allowed to use this chat widget.",
    };
  }

  return { ok: true, chatbot, host: claims.host, isPreview: claims.isPreview };
}

export { PREVIEW_HOST };

export function buildUnavailableReply(chatbotName: string) {
  return `${chatbotName} is currently offline. Leave your message and a team member can follow up later.`;
}

export function buildAiLimitReply(limit: number) {
  return `You have reached the AI reply limit for this conversation (${limit}). Share your email and our team will continue from there.`;
}

export function buildHandoffNotice() {
  return "Thanks! A team member is online and will reply here shortly.";
}

export type WidgetReplyDecision =
  | { action: "AI_NOW" }
  | { action: "WAIT_FOR_HUMAN"; notice: string | null }
  | { action: "SYSTEM"; content: string };

/**
 * Decides how the widget answers a new customer message (SRS FR-14.2 – FR-14.8).
 */
export async function decideWidgetReply({
  chatbot,
  sessionId,
  sessionStatus,
}: {
  chatbot: WidgetChatbot;
  sessionId: string;
  sessionStatus: string;
}): Promise<WidgetReplyDecision> {
  if (sessionStatus === "ESCALATED") {
    return { action: "WAIT_FOR_HUMAN", notice: null };
  }

  if (!chatbot.aiRepliesEnabled || chatbot.agent.status !== "ACTIVE") {
    const alreadyNotified = await prisma.chatMessage.count({
      where: { sessionId, sender: "SYSTEM" },
    });

    return alreadyNotified > 0
      ? { action: "WAIT_FOR_HUMAN", notice: null }
      : { action: "SYSTEM", content: buildUnavailableReply(chatbot.name) };
  }

  const aiReplyCount = await prisma.chatMessage.count({
    where: { sessionId, sender: "AI" },
  });

  if (aiReplyCount >= chatbot.maxAiMessages) {
    return { action: "SYSTEM", content: buildAiLimitReply(chatbot.maxAiMessages) };
  }

  if (chatbot.replyMode === "ALWAYS") {
    return { action: "AI_NOW" };
  }

  const operatorsOnline = await isWorkspaceOnline(chatbot.workspaceId);

  if (!operatorsOnline) {
    return { action: "AI_NOW" };
  }

  const alreadyNotified = await prisma.chatMessage.count({
    where: { sessionId, sender: "SYSTEM" },
  });

  return {
    action: "WAIT_FOR_HUMAN",
    notice: alreadyNotified > 0 ? null : buildHandoffNotice(),
  };
}

/**
 * FALLBACK mode: if no human answered the latest customer message within the
 * configured delay, the AI steps in. Returns true when an AI reply is due.
 */
export async function isFallbackReplyDue(chatbot: WidgetChatbot, sessionId: string) {
  if (
    chatbot.replyMode !== "FALLBACK" ||
    !chatbot.isActive ||
    !chatbot.aiRepliesEnabled ||
    chatbot.agent.status !== "ACTIVE"
  ) {
    return false;
  }

  const [lastCustomerMessage, session] = await Promise.all([
    prisma.chatMessage.findFirst({
      where: { sessionId, sender: "USER" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.chatSession.findUnique({ where: { id: sessionId }, select: { status: true } }),
  ]);

  if (!lastCustomerMessage || session?.status === "ESCALATED") {
    return false;
  }

  const answeredAfter = await prisma.chatMessage.count({
    where: {
      sessionId,
      sender: { in: ["AI", "AGENT"] },
      createdAt: { gt: lastCustomerMessage.createdAt },
    },
  });

  if (answeredAfter > 0) {
    return false;
  }

  const aiReplyCount = await prisma.chatMessage.count({ where: { sessionId, sender: "AI" } });

  return (
    aiReplyCount < chatbot.maxAiMessages &&
    Date.now() - lastCustomerMessage.createdAt.getTime() >= chatbot.fallbackDelaySeconds * 1000
  );
}
