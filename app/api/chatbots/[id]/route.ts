import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type ChatbotRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(
  _request: Request,
  context: ChatbotRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;

  const chatbot = await prisma.chatbot.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!chatbot) {
    return NextResponse.json(
      { error: "Chatbot not found in this workspace." },
      { status: 404 },
    );
  }

  await prisma.chatbot.delete({
    where: {
      id,
    },
  });

  return NextResponse.json({ success: true });
}
