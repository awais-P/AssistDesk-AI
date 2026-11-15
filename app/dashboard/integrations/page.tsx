import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/lib/auth";
import { hasRole } from "@/src/lib/rbac";
import { prisma } from "@/src/lib/prisma";
import {
  integrationInclude,
  serializeIntegration,
} from "@/src/lib/integrations/serialize";
import { IntegrationsWorkspace } from "@/src/components/dashboard/integrations-workspace";

export default async function IntegrationsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [integrations, inboxes, agents, chatbots] = await Promise.all([
    prisma.integration.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      include: integrationInclude,
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
    prisma.chatbot.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        widgetId: true,
      },
    }),
  ]);

  return (
    <IntegrationsWorkspace
      // Serialized integrations carry masked secrets only; the webhook secret and verify
      // token reach the browser only for Admins and Owners (SEC-19).
      initialIntegrations={integrations.map((integration) =>
        serializeIntegration(integration, {
          includeSecrets: hasRole(session.user.role, "ADMIN"),
        }),
      )}
      inboxes={inboxes}
      agents={agents}
      initialChatbots={chatbots}
    />
  );
}
