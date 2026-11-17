import { NextResponse } from "next/server";
import { type ReplyStream, measuredStream } from "@/src/lib/llm-stream";
import { forwardReply, replyStreamResponse, wantsReplyStream } from "@/src/lib/reply-stream-response";
import { getCurrentSession } from "@/src/lib/auth";
import { checkLimit, limitMessage } from "@/src/lib/billing";
import { consumeRateLimit, RATE_LIMITS, tooManyRequests } from "@/src/lib/rate-limit";
import { hydrateKnowledgeSources } from "@/src/lib/knowledge-runtime";
import {
  type ConversationTurn,
  generateAgentReply,
  toRuntimeAgent,
} from "@/src/lib/llm-runtime";
import { runAgentReply } from "@/src/lib/agent-engine/run-agent";
import { getAgentRunDetail } from "@/src/lib/action-logs";
import { safeTimeZone } from "@/src/lib/analytics-math";
import { normalizeEmail, normalizePhone } from "@/src/lib/identity";
import { prisma } from "@/src/lib/prisma";
import { loadAgentToolset } from "@/src/lib/tools/registry";

type PlaygroundRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type PlaygroundPayload = {
  message?: string;
  history?: Array<{ role?: string; content?: string }>;
  /** Module 2: pretend to be this customer when testing tools. */
  customer?: { name?: unknown; email?: unknown; phone?: unknown };
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

  // Every test calls a model on the workspace's (or the platform's) key: 30 a minute per
  // user, and only while the plan still has AI replies this month (SEC-39).
  const limit = await consumeRateLimit(`ai-test:${session.user.id}`, RATE_LIMITS.aiTestPerUser);

  if (!limit.allowed) {
    return tooManyRequests(limit, "Too many test messages. Wait a moment and try again.");
  }

  const replies = await checkLimit(session.user.workspaceId, "aiReplies");

  if (!replies.allowed) {
    return NextResponse.json(
      { error: limitMessage("aiReplies", replies), code: "plan_limit" },
      { status: 402 },
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

  // Latency: everything after the checks runs inside `produce`, which can stream.
  const produce = async (rawStream?: ReplyStream) => {
    const startedAt = Date.now();
    const measured = measuredStream(rawStream, startedAt);
    const stream = measured.stream;
    // Module 2: agents with tools reason here too, in test mode — lookups run for real,
    // actions that change something (tickets, bookings, leads, HTTP writes) are only simulated.
    const [hydratedSources, toolset, settings] = await Promise.all([
      hydrateKnowledgeSources(
        agent.knowledgeSources.map((source) => ({
          id: source.id,
          title: source.title,
          type: source.type,
          status: source.status,
          sourceUrl: source.sourceUrl,
          rawText: source.rawText,
        })),
      ),
      loadAgentToolset(session.user.workspaceId, agent.id),
      prisma.workspaceSetting.findUnique({ where: { workspaceId: session.user.workspaceId }, select: { timezone: true } }),
    ]);
    const history = parseHistory(body.history);
    const testCustomer = {
      name: typeof body.customer?.name === "string" ? body.customer.name.trim().slice(0, 120) || null : null,
      email: typeof body.customer?.email === "string" ? normalizeEmail(body.customer.email) : null,
      phone: typeof body.customer?.phone === "string" ? normalizePhone(body.customer.phone) : null,
    };
    const response =
      toolset.tools.length > 0 && toolset.settings
        ? await runAgentReply({
            agent: { ...toRuntimeAgent(agent), id: agent.id },
            workspaceId: session.user.workspaceId,
            channel: "PLAYGROUND",
            source: "PLAYGROUND",
            question: message,
            history,
            sources: hydratedSources,
            tools: toolset.tools,
            settings: toolset.settings,
            ctx: {
              workspaceId: session.user.workspaceId,
              sessionId: null,
              ticketId: null,
              contactId: null,
              channel: "PLAYGROUND",
              verifiedIdentity: false,
              customer: testCustomer,
              timeZone: safeTimeZone(settings?.timezone ?? "UTC"),
              dryRun: true,
              triggeredBy: "MODEL",
            },
            stream,
          })
        : await generateAgentReply({ agent: toRuntimeAgent(agent), question: message, sources: hydratedSources, history, channel: "PLAYGROUND", stream });
    const agentic = response as Partial<{ runId: string; status: string; trace: unknown[]; toolCalls: number }>;
    // Total and first-word times share one starting point (loading included).
    const totalMs = Date.now() - startedAt;

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
        durationMs: totalMs,
        summary: response.usedFallback
          ? `Playground used the knowledge-base fallback: ${response.errorMessage ?? "no AI reply"}`
          : `Playground test completed with confidence ${response.confidence.toFixed(2)}.`,
      },
    });

    return {
      reply: response.reply,
      confidence: response.confidence,
      usedSourceIds: response.usedSourceIds,
      usedFallback: response.usedFallback,
      fallbackReason: response.errorMessage,
      modelUsed: response.modelUsed,
      latencyMs: totalMs,
      // Token streaming: when the first word appeared (null when the reply was not streamed).
      firstTokenMs: measured.firstTokenMs,
      tokens: response.tokens,
      // Module 2 FE-5: the chain of thought of this test (empty when the agent has no tools).
      toolsEnabled: toolset.tools.length > 0,
      runId: agentic.runId ?? null,
      runStatus: agentic.status ?? null,
      toolCalls: agentic.toolCalls ?? 0,
      trace: agentic.trace ?? [],
      run: agentic.runId ? await getAgentRunDetail(session.user.workspaceId, agentic.runId) : null,
    };
  };

  if (wantsReplyStream(request)) {
    return replyStreamResponse(async (send) => {
      send({ type: "start" });
      send({ type: "done", ...(await produce(forwardReply(send))) });
    }, "The agent could not finish its reply. Check the provider settings and try again.");
  }

  return NextResponse.json(await produce());
}
