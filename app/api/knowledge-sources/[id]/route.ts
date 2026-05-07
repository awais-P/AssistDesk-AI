import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
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
