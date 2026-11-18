import { NextResponse } from "next/server";
import { requirePermission } from "@/src/lib/access";
import { auditUser } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import {
  deleteStoredKnowledgeFile,
  purgeKnowledgeSourceVectors,
  queueKnowledgeSourceProcessing,
} from "@/src/lib/knowledge-indexing";
import { prisma } from "@/src/lib/prisma";

const MAX_BULK_SOURCES = 100;

type BulkPayload = { action?: unknown; ids?: unknown };

/**
 * FR-10.6: act on several knowledge sources at once from the table's checkboxes.
 *   { action: "reindex", ids } → each is processed again (text, chunks, vectors)
 *   { action: "delete", ids }  → each is removed with its vectors and stored file
 * Only sources of the caller's workspace are touched; the others are reported as skipped.
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

  const body = (await request.json().catch(() => ({}))) as BulkPayload;
  const action = body.action;
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 40))]
    : [];

  if (action !== "reindex" && action !== "delete") {
    return NextResponse.json({ error: 'Choose "reindex" or "delete".' }, { status: 400 });
  }

  if (ids.length === 0) {
    return NextResponse.json({ error: "Select at least one knowledge source." }, { status: 400 });
  }

  if (ids.length > MAX_BULK_SOURCES) {
    return NextResponse.json({ error: `Select at most ${MAX_BULK_SOURCES} sources at a time.` }, { status: 400 });
  }

  const sources = await prisma.knowledgeSource.findMany({
    where: { id: { in: ids }, workspaceId: session.user.workspaceId, status: { not: "DELETED" } },
    select: { id: true, title: true, workspaceId: true, storagePath: true, chunkCount: true, vectorStore: true },
  });
  const skipped = ids.length - sources.length;

  if (action === "reindex") {
    await prisma.knowledgeSource.updateMany({
      where: { id: { in: sources.map((source) => source.id) } },
      data: { status: "PENDING", processingError: null },
    });
    const queued = sources.filter((source) => queueKnowledgeSourceProcessing(source.id)).length;

    await auditUser(session.user, {
      action: "knowledge.reindexed",
      category: "ai",
      summary: `${session.user.fullName} re-indexed ${sources.length} knowledge source${sources.length === 1 ? "" : "s"}`,
      targetType: "knowledge_source",
      metadata: { ids: sources.map((source) => source.id) },
      request,
    });

    return NextResponse.json({ action, processed: sources.length, queued, skipped });
  }

  // Delete: vectors and files first, so nothing is left behind if a row fails.
  const failed: string[] = [];

  for (const source of sources) {
    try {
      await purgeKnowledgeSourceVectors(source);
      await deleteStoredKnowledgeFile(source.storagePath);
      await prisma.knowledgeSource.delete({ where: { id: source.id } });
    } catch (error) {
      console.error(`[knowledge] Bulk delete of ${source.id} failed:`, error);
      failed.push(source.id);
    }
  }

  const deleted = sources.length - failed.length;
  await auditUser(session.user, {
    action: "knowledge.deleted",
    category: "ai",
    summary: `${session.user.fullName} deleted ${deleted} knowledge source${deleted === 1 ? "" : "s"}`,
    targetType: "knowledge_source",
    metadata: { ids: sources.filter((source) => !failed.includes(source.id)).map((source) => source.id), titles: sources.map((source) => source.title).slice(0, 20) },
    request,
  });

  return NextResponse.json({ action, processed: deleted, failed, skipped });
}
