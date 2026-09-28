import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  type WidgetChatbot,
  authorizeWidgetRequest,
  decideWidgetReply,
  isFallbackReplyDue,
} from "@/src/lib/chatbot-widget";
import { generateSessionReply, loadAgentForReplies } from "@/src/lib/conversation-runtime";
import { isWorkspaceOnline } from "@/src/lib/presence";
import { prisma } from "@/src/lib/prisma";
import { isTrustedUploadUrl } from "@/src/lib/uploads";

type WidgetMessagesRouteContext = {
  params: Promise<{
    widgetId: string;
  }>;
};

type WidgetAttachment = {
  url: string;
  name: string;
  mimeType: string;
  size: number;
};

type WidgetMessagePayload = {
  sessionId?: string;
  message?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  attachments?: unknown;
};

const MAX_MESSAGE_LENGTH = 2000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^[+()\d\s-]{6,20}$/;

declare global {
  var widgetFallbackLocks: Set<string> | undefined;
}

const fallbackLocks = global.widgetFallbackLocks ?? new Set<string>();
global.widgetFallbackLocks = fallbackLocks;

function trimNullable(value?: string | null, maxLength = 160) {
  const trimmed = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  return trimmed ? trimmed : null;
}

function parseAttachments(value: unknown): WidgetAttachment[] | null {
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

function serializeMessage(message: {
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

function serializeSession(session: {
  id: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  status: string;
}) {
  return {
    id: session.id,
    customerName: session.customerName,
    customerEmail: session.customerEmail,
    customerPhone: session.customerPhone,
    status: session.status,
  };
}

async function replyWithAgent(chatbot: WidgetChatbot, sessionId: string) {
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

async function runFallbackIfDue(chatbot: WidgetChatbot, sessionId: string) {
  if (fallbackLocks.has(sessionId) || !(await isFallbackReplyDue(chatbot, sessionId))) {
    return;
  }

  fallbackLocks.add(sessionId);

  try {
    await replyWithAgent(chatbot, sessionId);
  } finally {
    fallbackLocks.delete(sessionId);
  }
}

export async function GET(
  request: Request,
  context: WidgetMessagesRouteContext,
) {
  const { widgetId } = await context.params;
  const access = await authorizeWidgetRequest(request, widgetId);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { chatbot } = access;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const operatorsOnline = await isWorkspaceOnline(chatbot.workspaceId);

  if (!sessionId) {
    return NextResponse.json({ session: null, messages: [], operatorsOnline });
  }

  const session = await prisma.chatSession.findFirst({
    where: {
      id: sessionId,
      chatbotId: chatbot.id,
      workspaceId: chatbot.workspaceId,
    },
  });

  if (!session) {
    return NextResponse.json({ session: null, messages: [], operatorsOnline });
  }

  await runFallbackIfDue(chatbot, session.id);

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    session: serializeSession(session),
    messages: messages.reverse().map(serializeMessage),
    operatorsOnline,
  });
}

export async function POST(
  request: Request,
  context: WidgetMessagesRouteContext,
) {
  const { widgetId } = await context.params;
  const access = await authorizeWidgetRequest(request, widgetId);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { chatbot } = access;

  if (!chatbot.isActive) {
    return NextResponse.json(
      { error: `${chatbot.name} is paused right now. Please try again later.` },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as WidgetMessagePayload | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const customerName = trimNullable(body.customerName, 120);
  const customerEmail = trimNullable(body.customerEmail, 160)?.toLowerCase() ?? null;
  const customerPhone = trimNullable(body.customerPhone, 32);
  const content = typeof body.message === "string" ? body.message.trim() : "";
  const attachments = parseAttachments(body.attachments);

  if (!attachments) {
    return NextResponse.json(
      { error: "One of the attachments is invalid. Please upload it again." },
      { status: 400 },
    );
  }

  if (!content && attachments.length === 0) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Messages can be up to ${MAX_MESSAGE_LENGTH} characters.` },
      { status: 400 },
    );
  }

  if (customerEmail && !EMAIL_PATTERN.test(customerEmail)) {
    return NextResponse.json(
      { error: "Please enter a valid email address, like name@example.com." },
      { status: 400 },
    );
  }

  if (customerPhone && !PHONE_PATTERN.test(customerPhone)) {
    return NextResponse.json(
      { error: "Please enter a valid phone number, digits only with an optional +." },
      { status: 400 },
    );
  }

  let session = body.sessionId
    ? await prisma.chatSession.findFirst({
        where: {
          id: body.sessionId,
          chatbotId: chatbot.id,
          workspaceId: chatbot.workspaceId,
        },
      })
    : null;

  const knownName = customerName ?? session?.customerName ?? null;
  const knownEmail = customerEmail ?? session?.customerEmail ?? null;
  const knownPhone = customerPhone ?? session?.customerPhone ?? null;

  if (chatbot.requireName && !knownName) {
    return NextResponse.json(
      { error: "Please provide your name before starting the chat." },
      { status: 400 },
    );
  }

  if (chatbot.requireEmail && !knownEmail) {
    return NextResponse.json(
      { error: "Please provide your email before starting the chat." },
      { status: 400 },
    );
  }

  if (chatbot.requirePhone && !knownPhone) {
    return NextResponse.json(
      { error: "Please provide your phone number before starting the chat." },
      { status: 400 },
    );
  }

  if (!session || session.status === "CLOSED") {
    session = await prisma.chatSession.create({
      data: {
        workspaceId: chatbot.workspaceId,
        chatbotId: chatbot.id,
        customerName: knownName,
        customerEmail: knownEmail,
        customerPhone: knownPhone,
        channel: "WEB_WIDGET",
        status: "ACTIVE",
      },
    });
  } else if (
    session.customerName !== knownName ||
    session.customerEmail !== knownEmail ||
    session.customerPhone !== knownPhone
  ) {
    // Only fill in or change details the visitor actually sent; never wipe them.
    session = await prisma.chatSession.update({
      where: { id: session.id },
      data: {
        customerName: knownName,
        customerEmail: knownEmail,
        customerPhone: knownPhone,
      },
    });
  }

  const userMessage = await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      sender: "USER",
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      authorName: knownName,
    },
  });

  const decision = await decideWidgetReply({
    chatbot,
    sessionId: session.id,
    sessionStatus: session.status,
  });
  const newMessages = [userMessage];

  if (decision.action === "AI_NOW") {
    const aiMessage = await replyWithAgent(chatbot, session.id);

    if (aiMessage) {
      newMessages.push(aiMessage);
    }
  } else {
    const notice = decision.action === "SYSTEM" ? decision.content : decision.notice;

    if (notice) {
      newMessages.push(
        await prisma.chatMessage.create({
          data: { sessionId: session.id, sender: "SYSTEM", content: notice },
        }),
      );
    }
  }

  return NextResponse.json({
    session: serializeSession(session),
    messages: newMessages.map(serializeMessage),
    waitingForHuman: decision.action === "WAIT_FOR_HUMAN",
  });
}
