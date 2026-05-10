import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { fetchKnowledgeSourceText } from "@/src/lib/knowledge-runtime";
import { prisma } from "@/src/lib/prisma";

type KnowledgeSourceRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(
  _request: Request,
  context: KnowledgeSourceRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;

  const knowledgeSource = await prisma.knowledgeSource.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!knowledgeSource) {
    return NextResponse.json(
      { error: "Knowledge source not found in this workspace." },
      { status: 404 },
    );
  }

  await prisma.knowledgeSource.delete({
    where: {
      id,
    },
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: Request,
  context: KnowledgeSourceRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;

  const existing = await prisma.knowledgeSource.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    select: {
      id: true,
      type: true,
      sourceUrl: true,
    },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Knowledge source not found in this workspace." },
      { status: 404 },
    );
  }

  const body = await request.json();

  const data: Record<string, unknown> = {};

  if (typeof body.title === "string") data.title = body.title.trim();
  if (typeof body.sourceUrl === "string") data.sourceUrl = body.sourceUrl.trim() || null;
  if (typeof body.rawText === "string") data.rawText = body.rawText.trim() || null;
  if (typeof body.fileName === "string") data.fileName = body.fileName.trim() || null;
  if (typeof body.mimeType === "string") data.mimeType = body.mimeType.trim() || null;
  if (typeof body.agentId !== "undefined") data.agentId = body.agentId || null;
  if (typeof body.status === "string") data.status = body.status;

  // validate agentId if provided
  if (data.agentId) {
    const agent = await prisma.aIAgent.findFirst({
      where: { id: data.agentId, workspaceId: session.user.workspaceId },
      select: { id: true },
    });

    if (!agent) {
      return NextResponse.json(
        { error: "Selected AI agent does not exist in this workspace." },
        { status: 404 },
      );
    }
  }

  const nextSourceUrl =
    typeof data.sourceUrl === "string" || data.sourceUrl === null
      ? (data.sourceUrl as string | null)
      : existing.sourceUrl;

  if (data.status === "SYNCED") {
    if (existing.type === "URL" && nextSourceUrl) {
      try {
        data.rawText = await fetchKnowledgeSourceText(nextSourceUrl);
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Unable to fetch readable content from this URL.",
          },
          { status: 400 },
        );
      }
    }

    data.lastSyncedAt = new Date();
  }

  const updated = await prisma.knowledgeSource.update({
    where: { id },
    data,
    include: { agent: true },
  });

  return NextResponse.json({ knowledgeSource: updated });
}
