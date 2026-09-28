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
      chatbots: {
        select: { name: true },
      },
    },
  });

  if (!agent) {
    return NextResponse.json(
      { error: "AI agent not found in this workspace." },
      { status: 404 },
    );
  }

  if (agent.chatbots.length > 0) {
    const names = agent.chatbots.map((chatbot) => chatbot.name).join(", ");

    return NextResponse.json(
      {
        error: `This agent powers ${agent.chatbots.length} chatbot(s): ${names}. Link those chatbots to another agent or delete them first, so live widgets don't break.`,
      },
      { status: 409 },
    );
  }

  await prisma.aIAgent.delete({
    where: {
      id,
    },
  });

  return NextResponse.json({ success: true });
}
