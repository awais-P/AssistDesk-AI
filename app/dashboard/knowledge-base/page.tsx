import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/lib/auth";
import { getConfiguredEmbeddingModel } from "@/src/lib/embeddings";
import { recoverStaleKnowledgeJobs } from "@/src/lib/knowledge-indexing";
import { prisma } from "@/src/lib/prisma";
import { hasRole } from "@/src/lib/rbac";
import { isPineconeConfigured } from "@/src/lib/vector-store";
import { KnowledgeBaseClient } from "@/src/components/dashboard/knowledge-base-client";

export default async function KnowledgeBasePage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  // Re-queue jobs interrupted by a server restart so the list heals itself.
  try {
    await recoverStaleKnowledgeJobs(session.user.workspaceId);
  } catch (error) {
    console.error("[knowledge-base] Unable to recover stale indexing jobs:", error);
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
      embeddingModel: true,
      vectorStore: true,
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

  return (
    <KnowledgeBaseClient
      initialSources={sources}
      canManage={hasRole(session.user.role, "MANAGER")}
      pineconeConfigured={isPineconeConfigured()}
      embeddingModel={getConfiguredEmbeddingModel()}
    />
  );
}
