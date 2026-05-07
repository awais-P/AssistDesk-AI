import { redirect } from "next/navigation";
import { WorkspaceResourceOverview } from "@/src/components/dashboard/workspace-resource-overview";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

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
      createdAt: "asc",
    },
  });

  return (
    <WorkspaceResourceOverview
      title="Knowledge Base"
      moduleLabel="Module 10 - Knowledge Base Management"
      description="Review the website URLs, text snippets, and future document sources attached to your workspace knowledge base. Setup uses the same database-backed records."
      items={sources.map((source) => ({
        id: source.id,
        title: source.title,
        meta: source.agent?.name || "Not linked to an agent yet",
        description:
          source.sourceUrl ||
          source.fileName ||
          source.rawText?.slice(0, 140) ||
          "No preview available.",
        badges: [source.type, source.status],
      }))}
    />
  );
}
