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
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      sourceUrl: true,
      fileName: true,
      mimeType: true,
      storagePath: true,
      fileSize: true,
      rawText: true,
      crawlMode: true,
      maxPages: true,
      pageCount: true,
      chunkCount: true,
      vectorIndexedAt: true,
      processingError: true,
      createdAt: true,
      updatedAt: true,
      lastSyncedAt: true,
      agent: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 100,
  });

  return <KnowledgeBaseClient initialSources={sources} />;
}
