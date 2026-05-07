import { notFound, redirect } from "next/navigation";
import { AgentConfigurationWorkspace } from "@/src/components/dashboard/agent-configuration-workspace";
import { ensureAgentAutomationDefaults } from "@/src/lib/agent-automations";
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

  const automations = await ensureAgentAutomationDefaults(
    session.user.workspaceId,
    agent.id,
  );

  return (
    <AgentConfigurationWorkspace
      initialTab={normalizeTab(resolvedSearchParams.tab)}
      initialAgent={{
        id: agent.id,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        temperature: agent.temperature,
        confidenceThreshold: agent.confidenceThreshold,
        status: agent.status,
      }}
      initialSources={agent.knowledgeSources.map((source) => ({
        id: source.id,
        title: source.title,
        type: source.type,
        status: source.status,
        sourceUrl: source.sourceUrl,
        fileName: source.fileName,
        rawText: source.rawText,
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
