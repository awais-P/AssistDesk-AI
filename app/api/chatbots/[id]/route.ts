import { requireRole } from "@/src/lib/rbac";
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


  const forbidden = requireRole(session.user, "MANAGER");


  if (forbidden) {

    return forbidden;

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

/** Pause or resume a chatbot widget immediately. */
export async function PATCH(request: Request, context: ChatbotRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }


  const forbidden = requireRole(session.user, "MANAGER");


  if (forbidden) {

    return forbidden;

  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { isActive?: unknown };

  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive must be true or false." }, { status: 400 });
  }

  const result = await prisma.chatbot.updateMany({
    where: { id, workspaceId: session.user.workspaceId },
    data: { isActive: body.isActive },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Chatbot not found in this workspace." }, { status: 404 });
  }

  return NextResponse.json({ success: true, isActive: body.isActive });
}
