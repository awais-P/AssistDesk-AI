import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { KnowledgeSourceDetailWorkspace } from "@/src/components/dashboard/knowledge-source-detail-workspace";

type KnowledgeSourceDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function KnowledgeSourceDetailPage({
  params,
}: KnowledgeSourceDetailPageProps) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  const source = await prisma.knowledgeSource.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    include: {
      agent: true,
      chunks: {
        orderBy: {
          chunkIndex: "asc",
        },
        take: 12,
      },
    },
  });

  if (!source) {
    notFound();
  }

  return (
    <KnowledgeSourceDetailWorkspace
      source={{
        ...source,
        createdAt: source.createdAt.toISOString(),
        updatedAt: source.updatedAt.toISOString(),
        lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
        vectorIndexedAt: source.vectorIndexedAt?.toISOString() ?? null,
        chunks: source.chunks.map((chunk) => ({
          ...chunk,
          updatedAt: chunk.updatedAt.toISOString(),
        })),
      }}
    />
  );
}
