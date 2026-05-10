import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import {
  deleteStoredKnowledgeFile,
  queueKnowledgeSourceProcessing,
  saveKnowledgeSourceFile,
} from "@/src/lib/knowledge-indexing";
import { prisma } from "@/src/lib/prisma";

type KnowledgeSourceRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function isMultipartRequest(request: Request) {
  return (
    request.headers.get("content-type")?.includes("multipart/form-data") ?? false
  );
}

function normalizeTextValue(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function validateAgent(workspaceId: string, agentId: string | null) {
  if (!agentId) {
    return;
  }

  const agent = await prisma.aIAgent.findFirst({
    where: {
      id: agentId,
      workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!agent) {
    throw new Error("Selected AI agent does not exist in this workspace.");
  }
}

async function getWorkspaceSource(workspaceId: string, id: string) {
  return prisma.knowledgeSource.findFirst({
    where: {
      id,
      workspaceId,
    },
    include: {
      agent: true,
    },
  });
}

export async function GET(
  _request: Request,
  context: KnowledgeSourceRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const knowledgeSource = await getWorkspaceSource(session.user.workspaceId, id);

  if (!knowledgeSource) {
    return NextResponse.json(
      { error: "Knowledge source not found in this workspace." },
      { status: 404 },
    );
  }

  return NextResponse.json({ knowledgeSource });
}

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
      storagePath: true,
    },
  });

  if (!knowledgeSource) {
    return NextResponse.json(
      { error: "Knowledge source not found in this workspace." },
      { status: 404 },
    );
  }

  await deleteStoredKnowledgeFile(knowledgeSource.storagePath);
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
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
      type: true,
      storagePath: true,
      fileName: true,
      mimeType: true,
    },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Knowledge source not found in this workspace." },
      { status: 404 },
    );
  }

  try {
    const data: Record<string, unknown> = {};
    let shouldQueue = false;
    let replacementFile: File | null = null;

    if (isMultipartRequest(request)) {
      const formData = await request.formData();
      const uploadedFile = formData.get("file");

      if (typeof formData.get("title") === "string") {
        data.title = normalizeTextValue(formData.get("title"));
      }

      if (typeof formData.get("sourceUrl") === "string") {
        data.sourceUrl = normalizeTextValue(formData.get("sourceUrl"));
      }

      if (typeof formData.get("rawText") === "string") {
        data.rawText = normalizeTextValue(formData.get("rawText"));
      }

      if (typeof formData.get("fileName") === "string") {
        data.fileName = normalizeTextValue(formData.get("fileName"));
      }

      if (typeof formData.get("mimeType") === "string") {
        data.mimeType = normalizeTextValue(formData.get("mimeType"));
      }

      if (formData.has("agentId")) {
        data.agentId = normalizeTextValue(formData.get("agentId"));
      }

      if (typeof formData.get("status") === "string") {
        data.status = normalizeTextValue(formData.get("status"));
      }

      replacementFile = uploadedFile instanceof File ? uploadedFile : null;
    } else {
      const body = (await request.json()) as Record<string, unknown>;

      if (typeof body.title === "string") data.title = body.title.trim();
      if (typeof body.sourceUrl === "string") data.sourceUrl = body.sourceUrl.trim() || null;
      if (typeof body.rawText === "string") data.rawText = body.rawText.trim() || null;
      if (typeof body.fileName === "string") data.fileName = body.fileName.trim() || null;
      if (typeof body.mimeType === "string") data.mimeType = body.mimeType.trim() || null;
      if (typeof body.agentId !== "undefined") data.agentId = body.agentId || null;
      if (typeof body.status === "string") data.status = body.status.trim();
    }

    await validateAgent(session.user.workspaceId, (data.agentId as string | null) ?? null);

    if (replacementFile) {
      const storedFile = await saveKnowledgeSourceFile({
        workspaceId: session.user.workspaceId,
        file: replacementFile,
      });

      await deleteStoredKnowledgeFile(existing.storagePath);
      data.fileName = storedFile.fileName;
      data.mimeType = storedFile.mimeType;
      data.fileSize = storedFile.fileSize;
      data.storagePath = storedFile.storagePath;
      shouldQueue = true;
    }

    if (
      typeof data.sourceUrl !== "undefined" ||
      typeof data.rawText !== "undefined" ||
      typeof data.fileName !== "undefined" ||
      typeof data.mimeType !== "undefined"
    ) {
      shouldQueue = true;
    }

    if (typeof data.status === "string") {
      if (["PROCESSING", "PENDING", "SYNCED"].includes(data.status)) {
        data.status = "PROCESSING";
        shouldQueue = true;
      }
    }

    if (shouldQueue) {
      data.processingError = null;
      data.status = "PROCESSING";
    }

    const updated = await prisma.knowledgeSource.update({
      where: {
        id,
      },
      data,
      include: {
        agent: true,
      },
    });

    if (shouldQueue) {
      queueKnowledgeSourceProcessing(updated.id);
    }

    return NextResponse.json({ knowledgeSource: updated });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update this knowledge source.",
      },
      { status: 400 },
    );
  }
}
