import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type KnowledgeSourcePayload = {
  title?: string;
  type?: "URL" | "TEXT" | "FILE";
  sourceUrl?: string;
  rawText?: string;
  fileName?: string;
  mimeType?: string;
  agentId?: string | null;
};

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
      createdAt: "asc",
    },
  });

  return NextResponse.json({ knowledgeSources });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as KnowledgeSourcePayload;
  const title = body.title?.trim();
  const type = body.type;

  if (!title || !type) {
    return NextResponse.json(
      { error: "Knowledge source title and type are required." },
      { status: 400 },
    );
  }

  if (body.agentId) {
    const agent = await prisma.aIAgent.findFirst({
      where: {
        id: body.agentId,
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!agent) {
      return NextResponse.json(
        { error: "Selected AI agent does not exist in this workspace." },
        { status: 404 },
      );
    }
  }

  if (type === "URL" && !body.sourceUrl?.trim()) {
    return NextResponse.json(
      { error: "Please enter a website URL." },
      { status: 400 },
    );
  }

  if (type === "TEXT" && !body.rawText?.trim()) {
    return NextResponse.json(
      { error: "Please enter your knowledge text." },
      { status: 400 },
    );
  }

  const knowledgeSource = await prisma.knowledgeSource.create({
    data: {
      workspaceId: session.user.workspaceId,
      agentId: body.agentId || null,
      title,
      type,
      status: "SYNCED",
      sourceUrl: body.sourceUrl?.trim() || null,
      rawText: body.rawText?.trim() || null,
      fileName: body.fileName?.trim() || null,
      mimeType: body.mimeType?.trim() || null,
      lastSyncedAt: new Date(),
    },
    include: {
      agent: true,
    },
  });

  return NextResponse.json({ knowledgeSource });
}
