import { NextResponse } from "next/server";
import { requirePermission } from "@/src/lib/access";
import { getCurrentSession } from "@/src/lib/auth";
import { queueKnowledgeSourceProcessing } from "@/src/lib/knowledge-indexing";
import { prisma } from "@/src/lib/prisma";

/**
 * Re-indexes every knowledge source in the workspace, e.g. after switching the
 * embedding model or connecting Pinecone.
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "knowledge.manage", request);

  if (forbidden) {
    return forbidden;
  }

  const sources = await prisma.knowledgeSource.findMany({
    where: { workspaceId: session.user.workspaceId, status: { not: "DELETED" } },
    select: { id: true },
    take: 200,
  });

  await prisma.knowledgeSource.updateMany({
    where: { id: { in: sources.map((source) => source.id) } },
    data: { status: "PENDING", processingError: null },
  });

  const queued = sources.filter((source) => queueKnowledgeSourceProcessing(source.id)).length;

  return NextResponse.json({ success: true, queued });
}
