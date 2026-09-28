import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { hydrateKnowledgeSources } from "@/src/lib/knowledge-runtime";
import {
  type ConversationTurn,
  generateAgentReply,
  toRuntimeAgent,
} from "@/src/lib/llm-runtime";
import { prisma } from "@/src/lib/prisma";

type PlaygroundRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type PlaygroundPayload = {
  message?: string;
  history?: Array<{ role?: string; content?: string }>;
};

function parseHistory(history: PlaygroundPayload["history"]): ConversationTurn[] {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter(
      (turn) =>
        (turn?.role === "user" || turn?.role === "assistant") &&
        typeof turn.content === "string" &&
        turn.content.trim(),
    )
    .slice(-12)
    .map((turn) => ({
      role: turn.role as "user" | "assistant",
      content: (turn.content as string).slice(0, 4000),
    }));
}

export async function POST(
  request: Request,
  context: PlaygroundRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PlaygroundPayload;
  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json(
      { error: "A message is required to test the agent." },
      { status: 400 },
    );
  }

  const { id } = await context.params;

  const agent = await prisma.aIAgent.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    omit: { apiKey: false },
    include: {
      knowledgeSources: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!agent) {
    return NextResponse.json(
      { error: "AI agent not found in this workspace." },
      { status: 404 },
    );
  }

  const startedAt = Date.now();
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

  const response = await generateAgentReply({
    agent: toRuntimeAgent(agent),
    question: message,
    sources: hydratedSources,
    history: parseHistory(body.history),
    channel: "PLAYGROUND",
  });

  await prisma.automationLog.create({
    data: {
      workspaceId: session.user.workspaceId,
      agentId: agent.id,
      action: "PLAYGROUND_TEST",
      status:
        response.usedFallback
          ? "FALLBACK"
          : response.confidence >= agent.confidenceThreshold
            ? "SUCCESS"
            : "LOW_CONFIDENCE",
      model: response.modelUsed,
      tokens: response.tokens,
      durationMs: Date.now() - startedAt,
      summary: response.usedFallback
        ? `Playground used the knowledge-base fallback: ${response.errorMessage ?? "no AI reply"}`
        : `Playground test completed with confidence ${response.confidence.toFixed(2)}.`,
    },
  });

  return NextResponse.json({
    reply: response.reply,
    confidence: response.confidence,
    usedSourceIds: response.usedSourceIds,
    usedFallback: response.usedFallback,
    fallbackReason: response.errorMessage,
    modelUsed: response.modelUsed,
    latencyMs: response.latencyMs,
    tokens: response.tokens,
  });
}
