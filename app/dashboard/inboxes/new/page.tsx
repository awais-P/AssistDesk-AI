import { redirect } from "next/navigation";
import { InboxEditor } from "@/src/components/dashboard/inbox-editor";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

export default async function NewInboxPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [agents, cannedResponses] = await Promise.all([
    prisma.aIAgent.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    orderBy: {
      createdAt: "asc",
    },
  }),
    prisma.cannedResponse.findMany({
      where: { workspaceId: session.user.workspaceId },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
  ]);

  return (
    <InboxEditor
      mode="create"
      agentOptions={agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
      }))}
      cannedResponses={cannedResponses}
      currentUserEmail={session.user.email}
    />
  );
}
