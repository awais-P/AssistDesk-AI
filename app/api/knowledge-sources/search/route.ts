import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { retrieveVectorMatches } from "@/src/lib/knowledge-indexing";
import { prisma } from "@/src/lib/prisma";

const MAX_QUESTION_LENGTH = 500;
const MAX_SOURCE_IDS = 200;

type SearchPayload = {
  question?: unknown;
  agentId?: unknown;
  sourceIds?: unknown;
};

/**
 * Test retrieval against the knowledge base (Module 10 FE-2): runs the same hybrid
 * vector + keyword search the assistant uses and returns the top matches.
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as SearchPayload;
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
  const requestedSourceIds = Array.isArray(body.sourceIds)
    ? body.sourceIds.filter((value): value is string => typeof value === "string" && value.length > 0)
    : null;

  if (!question) {
    return NextResponse.json({ error: "Type a question to search for." }, { status: 400 });
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `Questions can be at most ${MAX_QUESTION_LENGTH} characters.` },
      { status: 400 },
    );
  }

  if (requestedSourceIds && requestedSourceIds.length > MAX_SOURCE_IDS) {
    return NextResponse.json(
      { error: `Search at most ${MAX_SOURCE_IDS} sources at a time.` },
      { status: 400 },
    );
  }

  const workspaceId = session.user.workspaceId;

  if (agentId) {
    const agent = await prisma.aIAgent.findFirst({
      where: { id: agentId, workspaceId },
      select: { id: true },
    });

    if (!agent) {
      return NextResponse.json(
        { error: "Selected AI agent does not exist in this workspace." },
        { status: 404 },
      );
    }
  }

  // Always scope to the caller's workspace, whichever filter was given.
  const sources = await prisma.knowledgeSource.findMany({
    where: {
      workspaceId,
      status: { not: "DELETED" },
      ...(agentId
        ? { agentId }
        : requestedSourceIds
          ? { id: { in: requestedSourceIds } }
          : {}),
    },
    select: { id: true },
    take: MAX_SOURCE_IDS,
  });

  const sourceIds = sources.map((source) => source.id);

  try {
    const matches = await retrieveVectorMatches({ question, sourceIds, topK: 5 });

    return NextResponse.json({ matches, searchedSources: sourceIds.length });
  } catch (error) {
    console.error("[knowledge-search] Retrieval failed:", error);

    return NextResponse.json(
      { error: "The knowledge base search failed. Try again in a moment." },
      { status: 500 },
    );
  }
}
