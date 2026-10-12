import { requireRole } from "@/src/lib/rbac";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import {
  type ChatbotReplyMode,
  chatbotReplyModeOptions,
  defaultChatbotSettings,
  defaultChatbotWelcomeMessage,
  sanitizeHexColor,
  type WidgetPosition,
  widgetPositionOptions,
} from "@/src/lib/chatbot-config";
import type { Prisma } from "@/app/generated/prisma/client";
import { parseLeadForm } from "@/src/lib/lead-form";
import { prisma } from "@/src/lib/prisma";
import { clampRateLimitPerMinute } from "@/src/lib/rate-limit";
import { clampSessionTimeoutMinutes } from "@/src/lib/session-lifecycle";
import { createWidgetId, isValidDomain, normalizeDomain } from "@/src/lib/setup";
import { isTrustedUploadUrl } from "@/src/lib/uploads";

type ChatbotPayload = {
  id?: string;
  name?: string;
  agentId?: string;
  allowedDomains?: string[];
  primaryColor?: string;
  welcomeMessage?: string;
  isActive?: boolean;
  maxAiMessages?: number;
  aiRepliesEnabled?: boolean;
  replyMode?: string;
  additionalPrompt?: string;
  widgetPosition?: string;
  requireName?: boolean;
  requireEmail?: boolean;
  requirePhone?: boolean;
  emailNotifications?: boolean;
  avatarUrl?: string | null;
  conversationStarters?: string[];
  fallbackDelaySeconds?: number;
  sessionTimeoutMinutes?: number;
  rateLimitPerMinute?: number;
  leadForm?: unknown;
};

const chatbotAgentSelect = {
  select: { id: true, name: true, status: true, model: true },
} as const;

const allowedReplyModes = new Set(
  chatbotReplyModeOptions.map((option) => option.value as string),
);
const allowedWidgetPositions = new Set(
  widgetPositionOptions.map((option) => option.value as string),
);

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const chatbots = await prisma.chatbot.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    include: {
      agent: chatbotAgentSelect,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return NextResponse.json({ chatbots });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }


  const forbidden = requireRole(session.user, "MANAGER");


  if (forbidden) {

    return forbidden;

  }

  const body = (await request.json().catch(() => ({}))) as ChatbotPayload;
  const name = body.name?.trim();
  const agentId = body.agentId?.trim();

  if (!name || !agentId) {
    return NextResponse.json(
      { error: "Chatbot name and linked AI agent are required." },
      { status: 400 },
    );
  }

  const agent = await prisma.aIAgent.findFirst({
    where: {
      id: agentId,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!agent) {
    return NextResponse.json(
      { error: "Selected AI agent does not exist in this workspace." },
      { status: 404 },
    );
  }

  const allowedDomains = Array.from(
    new Set(
      (Array.isArray(body.allowedDomains) ? body.allowedDomains : [])
        .filter((domain): domain is string => typeof domain === "string")
        .map(normalizeDomain)
        .filter(Boolean),
    ),
  );

  if (allowedDomains.length === 0) {
    return NextResponse.json(
      { error: "Please add at least one allowed domain, for example example.com." },
      { status: 400 },
    );
  }

  const invalidDomain = allowedDomains.find((domain) => !isValidDomain(domain));

  if (invalidDomain) {
    return NextResponse.json(
      {
        error: `"${invalidDomain}" is not a valid domain. Use a format like example.com or shop.example.com.`,
      },
      { status: 400 },
    );
  }

  if (
    typeof body.primaryColor === "string" &&
    !/^#[0-9a-fA-F]{6}$/.test(body.primaryColor.trim())
  ) {
    return NextResponse.json(
      { error: "Primary color must be a hex color like #3b82f6." },
      { status: 400 },
    );
  }

  const avatarUrl =
    typeof body.avatarUrl === "string" && body.avatarUrl.trim() ? body.avatarUrl.trim() : null;

  if (avatarUrl && !isTrustedUploadUrl(avatarUrl)) {
    return NextResponse.json(
      { error: "Upload the avatar image again; external image links are not accepted." },
      { status: 400 },
    );
  }

  const conversationStarters = (
    Array.isArray(body.conversationStarters) ? body.conversationStarters : []
  )
    .filter((starter): starter is string => typeof starter === "string")
    .map((starter) => starter.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 4);

  const replyMode: ChatbotReplyMode =
    body.replyMode && allowedReplyModes.has(body.replyMode)
      ? (body.replyMode as ChatbotReplyMode)
      : defaultChatbotSettings.replyMode;
  const widgetPosition: WidgetPosition =
    body.widgetPosition && allowedWidgetPositions.has(body.widgetPosition)
      ? (body.widgetPosition as WidgetPosition)
      : defaultChatbotSettings.widgetPosition;

  const baseData = {
    workspaceId: session.user.workspaceId,
    agentId,
    name,
    welcomeMessage:
      body.welcomeMessage?.trim() || defaultChatbotWelcomeMessage,
    allowedDomains,
    primaryColor: sanitizeHexColor(body.primaryColor || "#3b82f6"),
    isActive: typeof body.isActive === "boolean" ? body.isActive : true,
    maxAiMessages:
      typeof body.maxAiMessages === "number" && body.maxAiMessages > 0
        ? Math.min(1000, Math.round(body.maxAiMessages))
        : 20,
    aiRepliesEnabled:
      typeof body.aiRepliesEnabled === "boolean"
        ? body.aiRepliesEnabled
        : defaultChatbotSettings.aiRepliesEnabled,
    replyMode,
    additionalPrompt: body.additionalPrompt?.trim() || null,
    widgetPosition,
    requireName:
      typeof body.requireName === "boolean"
        ? body.requireName
        : defaultChatbotSettings.requireName,
    requireEmail:
      typeof body.requireEmail === "boolean"
        ? body.requireEmail
        : defaultChatbotSettings.requireEmail,
    requirePhone:
      typeof body.requirePhone === "boolean"
        ? body.requirePhone
        : defaultChatbotSettings.requirePhone,
    emailNotifications:
      typeof body.emailNotifications === "boolean"
        ? body.emailNotifications
        : defaultChatbotSettings.emailNotifications,
    avatarUrl,
    conversationStarters,
    fallbackDelaySeconds:
      typeof body.fallbackDelaySeconds === "number" && Number.isFinite(body.fallbackDelaySeconds)
        ? Math.min(600, Math.max(10, Math.round(body.fallbackDelaySeconds)))
        : 60,
    // Module 5: idle timeout of a widget session and messages allowed per session per minute.
    ...(body.sessionTimeoutMinutes !== undefined
      ? { sessionTimeoutMinutes: clampSessionTimeoutMinutes(body.sessionTimeoutMinutes) }
      : {}),
    ...(body.rateLimitPerMinute !== undefined
      ? { rateLimitPerMinute: clampRateLimitPerMinute(body.rateLimitPerMinute) }
      : {}),
    // Module 8: the lead capture form, sanitised (fields, trigger, texts).
    ...(body.leadForm !== undefined
      ? { leadForm: parseLeadForm(body.leadForm) as unknown as Prisma.InputJsonValue }
      : {}),
  };

  let chatbot;

  if (body.id) {
    const existingChatbot = await prisma.chatbot.findFirst({
      where: {
        id: body.id,
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!existingChatbot) {
      return NextResponse.json(
        { error: "Chatbot not found in this workspace." },
        { status: 404 },
      );
    }

    chatbot = await prisma.chatbot.update({
      where: {
        id: body.id,
      },
      data: baseData,
      include: {
        agent: chatbotAgentSelect,
      },
    });
  } else {
    chatbot = await prisma.chatbot.create({
      data: {
        ...baseData,
        widgetId: createWidgetId(name, session.user.workspaceId),
      },
      include: {
        agent: chatbotAgentSelect,
      },
    });
  }

  return NextResponse.json({ chatbot });
}
