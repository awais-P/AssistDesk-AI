import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import {
  fetchKnowledgeSourceText,
  queueKnowledgeSourceProcessing,
  saveKnowledgeSourceFile,
} from "@/src/lib/knowledge-indexing";
import { prisma } from "@/src/lib/prisma";

type KnowledgeSourceType = "URL" | "TEXT" | "FILE";

type JsonKnowledgeSourcePayload = {
  title?: string;
  type?: KnowledgeSourceType;
  sourceUrl?: string;
  rawText?: string;
  fileName?: string;
  mimeType?: string;
  agentId?: string | null;
};

type ParsedKnowledgeSourcePayload = {
  title: string;
  type: KnowledgeSourceType;
  sourceUrl: string | null;
  rawText: string | null;
  fileName: string | null;
  mimeType: string | null;
  agentId: string | null;
  uploadedFile: File | null;
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

async function parseKnowledgeSourcePayload(
  request: Request,
): Promise<ParsedKnowledgeSourcePayload> {
  if (isMultipartRequest(request)) {
    const formData = await request.formData();
    const uploadedFile = formData.get("file");

    return {
      title: normalizeTextValue(formData.get("title")) || "",
      type: (normalizeTextValue(formData.get("type")) || "URL") as KnowledgeSourceType,
      sourceUrl: normalizeTextValue(formData.get("sourceUrl")),
      rawText: normalizeTextValue(formData.get("rawText")),
      fileName: normalizeTextValue(formData.get("fileName")),
      mimeType: normalizeTextValue(formData.get("mimeType")),
      agentId: normalizeTextValue(formData.get("agentId")),
      uploadedFile: uploadedFile instanceof File ? uploadedFile : null,
    };
  }

  const body = (await request.json()) as JsonKnowledgeSourcePayload;

  return {
    title: body.title?.trim() || "",
    type: body.type || "URL",
    sourceUrl: body.sourceUrl?.trim() || null,
    rawText: body.rawText?.trim() || null,
    fileName: body.fileName?.trim() || null,
    mimeType: body.mimeType?.trim() || null,
    agentId: body.agentId?.trim() || null,
    uploadedFile: null,
  };
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

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const knowledgeSources = await prisma.knowledgeSource.findMany({
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

  return NextResponse.json({ knowledgeSources });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const payload = await parseKnowledgeSourcePayload(request);

    if (!payload.title || !payload.type) {
      return NextResponse.json(
        { error: "Knowledge source title and type are required." },
        { status: 400 },
      );
    }

    await validateAgent(session.user.workspaceId, payload.agentId);

    if (payload.type === "URL" && !payload.sourceUrl) {
      return NextResponse.json(
        { error: "Please enter a website URL." },
        { status: 400 },
      );
    }

    if (payload.type === "TEXT" && !payload.rawText) {
      return NextResponse.json(
        { error: "Please enter the text content for this source." },
        { status: 400 },
      );
    }

    if (payload.type === "FILE" && !payload.uploadedFile && !payload.fileName) {
      return NextResponse.json(
        { error: "Please upload a file for this knowledge source." },
        { status: 400 },
      );
    }

    let initialRawText = payload.rawText;

    if (payload.type === "URL" && payload.sourceUrl) {
      initialRawText = await fetchKnowledgeSourceText(payload.sourceUrl);
    }

    const created = await prisma.knowledgeSource.create({
      data: {
        workspaceId: session.user.workspaceId,
        agentId: payload.agentId,
        title: payload.title,
        type: payload.type,
        status: "PROCESSING",
        sourceUrl: payload.sourceUrl,
        rawText: initialRawText,
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        processingError: null,
      },
      include: {
        agent: true,
      },
    });

    let knowledgeSource = created;

    if (payload.type === "FILE" && payload.uploadedFile) {
      const storedFile = await saveKnowledgeSourceFile({
        workspaceId: session.user.workspaceId,
        file: payload.uploadedFile,
      });

      knowledgeSource = await prisma.knowledgeSource.update({
        where: {
          id: created.id,
        },
        data: {
          fileName: storedFile.fileName,
          mimeType: storedFile.mimeType,
          fileSize: storedFile.fileSize,
          storagePath: storedFile.storagePath,
        },
        include: {
          agent: true,
        },
      });
    }

    queueKnowledgeSourceProcessing(knowledgeSource.id);

    return NextResponse.json({ knowledgeSource });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create this knowledge source.",
      },
      { status: 400 },
    );
  }
}
