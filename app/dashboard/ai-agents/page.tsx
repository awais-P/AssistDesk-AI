import { redirect } from "next/navigation";
import { AgentsWorkspace } from "@/src/components/dashboard/agents-workspace";
import { serializeAgent } from "@/src/lib/agent-serializer";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

export default async function AIAgentsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [agents, inboxes] = await Promise.all([
    prisma.aIAgent.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
        name: true,
        provider: true,
        model: true,
        apiKey: true,
        systemPrompt: true,
        inboxId: true,
        temperature: true,
        confidenceThreshold: true,
        maxTokens: true,
        tone: true,
        responseLength: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        inbox: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 100,
    }),
    prisma.inbox.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
        name: true,
        emailPrefix: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
  ]);

  return (
    <AgentsWorkspace
      initialAgents={agents.map((agent) => {
        const serialized = serializeAgent(agent);

        return {
          id: serialized.id,
          name: serialized.name,
          provider: serialized.provider,
          model: serialized.model,
          hasApiKey: serialized.hasApiKey,
          apiKeyPreview: serialized.apiKeyPreview,
          systemPrompt: serialized.systemPrompt,
          inboxId: serialized.inboxId,
          inboxName: agent.inbox?.name ?? null,
          temperature: serialized.temperature,
          confidenceThreshold: serialized.confidenceThreshold,
          maxTokens: serialized.maxTokens,
          tone: serialized.tone,
          responseLength: serialized.responseLength,
          status: serialized.status,
        };
      })}
      inboxOptions={inboxes.map((inbox) => ({
        id: inbox.id,
        name: inbox.name,
        emailPrefix: inbox.emailPrefix,
      }))}
    />
  );
}
