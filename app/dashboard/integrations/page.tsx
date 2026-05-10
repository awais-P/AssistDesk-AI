import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/lib/auth";
import { ensureDemoData } from "@/src/lib/demo-data";
import { prisma } from "@/src/lib/prisma";
import { IntegrationsWorkspace } from "@/src/components/dashboard/integrations-workspace";

export default async function IntegrationsPage() {
  const [, session] = await Promise.all([ensureDemoData(), getCurrentSession()]);

  if (!session) {
    redirect("/login");
  }

  const [integrations, inboxes, agents] = await Promise.all([
    prisma.integration.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      include: {
        inbox: true,
        agent: true,
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
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        emailPrefix: true,
      },
    }),
    prisma.aIAgent.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        status: true,
      },
    }),
  ]);

  return (
    <IntegrationsWorkspace
      initialIntegrations={integrations.map((integration) => ({
        id: integration.id,
        type: integration.type,
        name: integration.name,
        provider: integration.provider,
        status: integration.status,
        supportAddress: integration.supportAddress,
        forwardingAddress: integration.forwardingAddress,
        webhookSecret: integration.webhookSecret,
        isActive: integration.isActive,
        inboxId: integration.inboxId,
        inboxName: integration.inbox?.name ?? null,
        agentId: integration.agentId,
        agentName: integration.agent?.name ?? null,
        config: (integration.config as Record<string, unknown> | null) ?? {},
      }))}
      inboxes={inboxes}
      agents={agents}
    />
  );
}
