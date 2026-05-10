import { redirect } from "next/navigation";
import { AgentsWorkspace } from "@/src/components/dashboard/agents-workspace";
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
      include: {
        inbox: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
    prisma.inbox.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
  ]);

  return (
    <AgentsWorkspace
      initialAgents={agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        apiKey: agent.apiKey,
        systemPrompt: agent.systemPrompt,
        inboxId: agent.inboxId,
        inboxName: agent.inbox?.name ?? null,
        temperature: agent.temperature,
        confidenceThreshold: agent.confidenceThreshold,
        status: agent.status,
      }))}
      inboxOptions={inboxes.map((inbox) => ({
        id: inbox.id,
        name: inbox.name,
        emailPrefix: inbox.emailPrefix,
      }))}
    />
  );
}
