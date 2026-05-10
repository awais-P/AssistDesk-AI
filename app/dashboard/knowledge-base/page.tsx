import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { KnowledgeBaseClient } from "@/src/components/dashboard/knowledge-base-client";

export default async function KnowledgeBasePage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const sources = await prisma.knowledgeSource.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    include: {
      agent: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return <KnowledgeBaseClient initialSources={sources} />;
}
