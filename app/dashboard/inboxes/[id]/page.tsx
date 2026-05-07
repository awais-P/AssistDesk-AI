import { redirect } from "next/navigation";
import { InboxEditor } from "@/src/components/dashboard/inbox-editor";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type InboxEditPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function InboxEditPage({ params }: InboxEditPageProps) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;

  const [inbox, agents] = await Promise.all([
    prisma.inbox.findFirst({
      where: {
        id,
        workspaceId: session.user.workspaceId,
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

  if (!inbox) {
    redirect("/dashboard/inboxes");
  }

  const assignedAgent = agents.find((agent) => agent.inboxId === inbox.id) ?? null;

  return (
    <InboxEditor
      mode="edit"
      inbox={{
        id: inbox.id,
        name: inbox.name,
        emailPrefix: inbox.emailPrefix,
        senderEmail: inbox.senderEmail,
        autoReplyEnabled: inbox.autoReplyEnabled,
        ticketPrefix: inbox.ticketPrefix,
        assignedAgentId: assignedAgent?.id ?? null,
      }}
      agentOptions={agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
      }))}
      currentUserEmail={session.user.email}
    />
  );
}
