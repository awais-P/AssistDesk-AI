import { redirect } from "next/navigation";
import { InboxesWorkspace } from "@/src/components/dashboard/inboxes-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

export default async function InboxesPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [inboxes, agents] = await Promise.all([
    prisma.inbox.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
    prisma.aIAgent.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
  ]);

  return (
    <InboxesWorkspace
      initialInboxes={inboxes.map((inbox) => {
        const assignedAgent =
          agents.find((agent) => agent.inboxId === inbox.id) ?? null;

        return {
          id: inbox.id,
          name: inbox.name,
          emailPrefix: inbox.emailPrefix,
          senderEmail: inbox.senderEmail,
          autoReplyEnabled: inbox.autoReplyEnabled,
          ticketPrefix: inbox.ticketPrefix,
          assignedAgentName: assignedAgent?.name ?? null,
        };
      })}
    />
  );
}
