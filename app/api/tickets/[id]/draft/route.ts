import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { hydrateKnowledgeSources } from "@/src/lib/knowledge-runtime";
import { generateAgentReply } from "@/src/lib/llm-runtime";
import { prisma } from "@/src/lib/prisma";

type TicketDraftRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type TicketDraftPayload = {
  prompt?: string;
};

function buildTicketThread(ticket: {
  subject: string;
  previewText: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  messages: Array<{ sender: string; content: string }>;
}) {
  const thread = ticket.messages
    .slice(-6)
    .map(
      (message) =>
        `${message.sender.toLowerCase()}: ${message.content.replace(
          "[[INTERNAL_NOTE]]\n",
          "",
        )}`,
    )
    .join("\n");

  return [
    `Subject: ${ticket.subject}`,
    ticket.previewText ? `Summary: ${ticket.previewText}` : "",
    ticket.requesterName ? `Requester: ${ticket.requesterName}` : "",
    ticket.requesterEmail ? `Requester Email: ${ticket.requesterEmail}` : "",
    thread ? `Conversation:\n${thread}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function POST(
  request: Request,
  context: TicketDraftRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as TicketDraftPayload;

  const ticket = await prisma.ticket.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    include: {
      inbox: true,
      messages: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const agent =
    (ticket.inboxId
      ? await prisma.aIAgent.findFirst({
          where: {
            workspaceId: session.user.workspaceId,
            inboxId: ticket.inboxId,
            status: "ACTIVE",
          },
          include: {
            knowledgeSources: {
              orderBy: {
                createdAt: "desc",
              },
            },
          },
        })
      : null) ||
    (await prisma.aIAgent.findFirst({
      where: {
        workspaceId: session.user.workspaceId,
        status: "ACTIVE",
      },
      include: {
        knowledgeSources: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    }));

  if (!agent) {
    return NextResponse.json(
      { error: "No active AI agent is available for this ticket." },
      { status: 400 },
    );
  }

  const hydratedSources = await hydrateKnowledgeSources(
    agent.knowledgeSources.map((source) => ({
      id: source.id,
      title: source.title,
      type: source.type,
      status: source.status,
      sourceUrl: source.sourceUrl,
      rawText: source.rawText,
    })),
  );

  const guidance = body.prompt?.trim()
    ? `Additional instruction: ${body.prompt.trim()}`
    : "Draft a concise, helpful reply for the requester using only the connected knowledge and ticket context.";

  const reply = await generateAgentReply({
    agent: {
      provider: agent.provider,
      model: agent.model,
      apiKey: agent.apiKey,
      systemPrompt: agent.systemPrompt,
      confidenceThreshold: agent.confidenceThreshold,
    },
    question: `${buildTicketThread(ticket)}\n\n${guidance}`,
    sources: hydratedSources,
  });

  await prisma.automationLog.create({
    data: {
      workspaceId: session.user.workspaceId,
      ticketId: ticket.id,
      agentId: agent.id,
      action: "AI_DRAFT",
      status: reply.usedFallback ? "FALLBACK" : "SUCCESS",
      model: reply.modelUsed,
      tokens: reply.tokens,
      summary: "AI assistant generated a reply draft for the ticket.",
    },
  });

  return NextResponse.json({
    draft: reply.reply,
    usedFallback: reply.usedFallback,
    modelUsed: reply.modelUsed,
  });
}
