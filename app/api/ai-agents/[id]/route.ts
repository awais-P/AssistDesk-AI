import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type AgentRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(
  _request: Request,
  context: AgentRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;

  const agent = await prisma.aIAgent.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!agent) {
    return NextResponse.json(
      { error: "AI agent not found in this workspace." },
      { status: 404 },
    );
  }

  await prisma.aIAgent.delete({
    where: {
      id,
    },
  });

  return NextResponse.json({ success: true });
}
