import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { hydrateKnowledgeSources } from "@/src/lib/knowledge-runtime";
import { generateAgentReply, toRuntimeAgent } from "@/src/lib/llm-runtime";
import { prisma } from "@/src/lib/prisma";
import { extractTemplateVariables, renderPromptTemplate } from "@/src/lib/prompt-templates";

type TicketDraftRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type TicketDraftPayload = {
  prompt?: unknown;
  promptTemplateId?: unknown;
};

const INTERNAL_NOTE_MARKER = "[[INTERNAL_NOTE]]";

function formatEnumLabel(value: string) {
  const text = value.toLowerCase().replace(/_/g, " ");

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildTicketThread(ticket: {
  subject: string;
  previewText: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  messages: Array<{ sender: string; content: string }>;
}) {
  // Internal notes are for the team only and must never reach a customer-facing draft (SEC-12).
  const thread = ticket.messages
    .filter((message) => !message.content.startsWith(INTERNAL_NOTE_MARKER))
    .slice(-6)
    .map((message) => `${message.sender.toLowerCase()}: ${message.content}`)
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
  const body = (await request.json().catch(() => ({}))) as TicketDraftPayload;
  const instructions = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const promptTemplateId =
    typeof body.promptTemplateId === "string" ? body.promptTemplateId.trim() : "";

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

  const promptTemplate = promptTemplateId
    ? await prisma.promptTemplate.findFirst({
        where: { id: promptTemplateId, workspaceId: session.user.workspaceId },
        select: { id: true, name: true, body: true },
      })
    : null;

  if (promptTemplateId && !promptTemplate) {
    return NextResponse.json(
      { error: "The selected prompt template no longer exists. Pick another prompt or leave it empty." },
      { status: 404 },
    );
  }

  const agent =
    (ticket.inboxId
      ? await prisma.aIAgent.findFirst({
          where: {
            workspaceId: session.user.workspaceId,
            inboxId: ticket.inboxId,
            status: "ACTIVE",
          },
          omit: { apiKey: false },
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
      omit: { apiKey: false },
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

  const ticketThread = buildTicketThread(ticket);
  let question: string;

  if (promptTemplate) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: session.user.workspaceId },
      select: { name: true },
    });
    const rendered = renderPromptTemplate(promptTemplate.body, {
      ticket: ticketThread,
      instructions,
      customer_name: ticket.requesterName ?? "",
      customer_email: ticket.requesterEmail ?? "",
      subject: ticket.subject,
      ticket_number: String(ticket.ticketNumber),
      status: formatEnumLabel(ticket.status),
      priority: formatEnumLabel(ticket.priority),
      agent_name: session.user.fullName,
      workspace_name: workspace?.name ?? "",
    });

    // Templates that don't reference {{ticket}} still need the ticket context.
    question = extractTemplateVariables(promptTemplate.body).includes("ticket")
      ? rendered
      : `${ticketThread}\n\n${rendered}`;
  } else {
    const guidance = instructions
      ? `Additional instruction: ${instructions}`
      : "Draft a concise, helpful reply for the requester using only the connected knowledge and ticket context.";

    question = `${ticketThread}\n\n${guidance}`;
  }

  const startedAt = Date.now();
  const reply = await generateAgentReply({
    agent: toRuntimeAgent(agent),
    question,
    sources: hydratedSources,
    channel: "EMAIL",
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
      durationMs: Date.now() - startedAt,
      summary: promptTemplate
        ? `AI assistant generated a reply draft using the "${promptTemplate.name}" prompt.`
        : "AI assistant generated a reply draft for the ticket.",
    },
  });

  return NextResponse.json({
    draft: reply.reply,
    usedFallback: reply.usedFallback,
    modelUsed: reply.modelUsed,
  });
}
