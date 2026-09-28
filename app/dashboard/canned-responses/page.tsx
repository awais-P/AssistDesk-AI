import { redirect } from "next/navigation";
import { CannedResponsesWorkspace } from "@/src/components/dashboard/canned-responses-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

export default async function CannedResponsesPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const cannedResponses = await prisma.cannedResponse.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
      title: true,
      body: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 100,
  });

  return (
    <CannedResponsesWorkspace
      initialResponses={cannedResponses.map((response) => ({
        id: response.id,
        title: response.title,
        body: response.body,
        createdAt: response.createdAt.toISOString(),
      }))}
      createdByName={session.user.fullName}
    />
  );
}
