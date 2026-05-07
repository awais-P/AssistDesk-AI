import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { defaultChatbotWelcomeMessage } from "@/src/lib/chatbot-config";
import { prisma } from "@/src/lib/prisma";
import { createWidgetId, normalizeDomain } from "@/src/lib/setup";

type ChatbotPayload = {
  id?: string;
  name?: string;
  agentId?: string;
  allowedDomains?: string[];
  primaryColor?: string;
  welcomeMessage?: string;
  isActive?: boolean;
  maxAiMessages?: number;
};

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
      agent: true,
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

  const body = (await request.json()) as ChatbotPayload;
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

  const allowedDomains =
    body.allowedDomains?.map(normalizeDomain).filter(Boolean) ?? [];

  if (allowedDomains.length === 0) {
    return NextResponse.json(
      { error: "Please add at least one allowed domain." },
      { status: 400 },
    );
  }

  const baseData = {
    workspaceId: session.user.workspaceId,
    agentId,
    name,
    welcomeMessage:
      body.welcomeMessage?.trim() || defaultChatbotWelcomeMessage,
    allowedDomains,
    primaryColor: body.primaryColor?.trim() || "#4f8cff",
    isActive:
      typeof body.isActive === "boolean" ? body.isActive : true,
    maxAiMessages:
      typeof body.maxAiMessages === "number" && body.maxAiMessages > 0
        ? body.maxAiMessages
        : 20,
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
        agent: true,
      },
    });
  } else {
    chatbot = await prisma.chatbot.create({
      data: {
        ...baseData,
        widgetId: createWidgetId(name, session.user.workspaceId),
      },
      include: {
        agent: true,
      },
    });
  }

  return NextResponse.json({ chatbot });
}
