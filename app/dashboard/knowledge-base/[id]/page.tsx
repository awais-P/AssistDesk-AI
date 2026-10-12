import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { hasRole } from "@/src/lib/rbac";
import { KnowledgeSourceDetailWorkspace } from "@/src/components/dashboard/knowledge-source-detail-workspace";

const CHUNKS_PER_PAGE = 20;

type KnowledgeSourceDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    chunkPage?: string | string[];
  }>;
};

function parsePage(value: string | string[] | undefined) {
  const page = Number.parseInt(Array.isArray(value) ? value[0] : (value ?? ""), 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export default async function KnowledgeSourceDetailPage({
  params,
  searchParams,
}: KnowledgeSourceDetailPageProps) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  const { chunkPage } = await searchParams;
  const source = await prisma.knowledgeSource.findFirst({
    where: {
      id,
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
  });

  if (!source) {
    notFound();
  }

  const totalChunks = await prisma.knowledgeChunk.count({
    where: { sourceId: source.id },
  });
  const chunkPageCount = Math.max(1, Math.ceil(totalChunks / CHUNKS_PER_PAGE));
  const currentChunkPage = Math.min(parsePage(chunkPage), chunkPageCount);
  const chunks = await prisma.knowledgeChunk.findMany({
    where: { sourceId: source.id },
    orderBy: {
      chunkIndex: "asc",
    },
    skip: (currentChunkPage - 1) * CHUNKS_PER_PAGE,
    take: CHUNKS_PER_PAGE,
    select: {
      id: true,
      chunkIndex: true,
      content: true,
      tokenCount: true,
      embeddingModel: true,
    },
  });

  return (
    <KnowledgeSourceDetailWorkspace
      canManage={hasRole(session.user.role, "MANAGER")}
      source={{
        ...source,
        createdAt: source.createdAt.toISOString(),
        updatedAt: source.updatedAt.toISOString(),
        lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
        vectorIndexedAt: source.vectorIndexedAt?.toISOString() ?? null,
      }}
      chunks={chunks}
      chunkPagination={{
        page: currentChunkPage,
        pageCount: chunkPageCount,
        perPage: CHUNKS_PER_PAGE,
        total: totalChunks,
      }}
    />
  );
}
