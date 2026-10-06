import { notFound, redirect } from "next/navigation";
import { AgentConfigurationWorkspace } from "@/src/components/dashboard/agent-configuration-workspace";
import { ensureAgentAutomationDefaults } from "@/src/lib/agent-automations";
import { serializeAgent } from "@/src/lib/agent-serializer";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type AgentDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    tab?: string;
  }>;
};

function normalizeTab(value?: string) {
  if (
    value === "overview" ||
    value === "sources" ||
    value === "automations" ||
    value === "actions" ||
    value === "playground" ||
    value === "settings"
  ) {
    return value;
  }

  return "overview";
}

export default async function AgentDetailPage({
  params,
  searchParams,
}: AgentDetailPageProps) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [{ id }, resolvedSearchParams] = await Promise.all([params, searchParams]);

  const agent = await prisma.aIAgent.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    // The key is loaded only so the server can build a masked preview.
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
    notFound();
  }

  const [automations, usage] = await Promise.all([
    ensureAgentAutomationDefaults(session.user.workspaceId, agent.id),
    // Every AI generation (Playground, widget, channels, tickets) is logged with its model.
    prisma.automationLog.aggregate({
      where: {
        workspaceId: session.user.workspaceId,
        agentId: agent.id,
        model: {
          not: null,
        },
      },
      _count: {
        _all: true,
      },
      _sum: {
        tokens: true,
      },
    }),
  ]);

  const serializedAgent = serializeAgent(agent);

  return (
    <AgentConfigurationWorkspace
      initialTab={normalizeTab(resolvedSearchParams.tab)}
      initialAgent={{
        id: serializedAgent.id,
        name: serializedAgent.name,
        provider: serializedAgent.provider,
        model: serializedAgent.model,
        hasApiKey: serializedAgent.hasApiKey,
        apiKeyPreview: serializedAgent.apiKeyPreview,
        systemPrompt: serializedAgent.systemPrompt,
        temperature: serializedAgent.temperature,
        confidenceThreshold: serializedAgent.confidenceThreshold,
        maxTokens: serializedAgent.maxTokens,
        tone: serializedAgent.tone,
        responseLength: serializedAgent.responseLength,
        status: serializedAgent.status,
        // Sent back on save so updating settings never unlinks the inbox.
        inboxId: serializedAgent.inboxId,
      }}
      usage={{
        replies: usage._count._all,
        tokens: usage._sum.tokens ?? 0,
      }}
      initialSources={agent.knowledgeSources.map((source) => ({
        id: source.id,
        title: source.title,
        type: source.type,
        status: source.status,
        sourceUrl: source.sourceUrl,
        fileName: source.fileName,
        rawText: source.rawText,
        pageCount: source.pageCount,
        processingError: source.processingError,
        lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
      }))}
      initialAutomations={automations.map((automation) => ({
        id: automation.id,
        key: automation.key,
        title: automation.title,
        description: automation.description,
        triggerType: automation.triggerType,
        summary: automation.summary,
        isEnabled: automation.isEnabled,
      }))}
    />
  );
}
