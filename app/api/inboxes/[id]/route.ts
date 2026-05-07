import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type InboxRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(
  _request: Request,
  context: InboxRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;

  const inbox = await prisma.inbox.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!inbox) {
    return NextResponse.json(
      { error: "Inbox not found in this workspace." },
      { status: 404 },
    );
  }

  await prisma.inbox.delete({
    where: {
      id,
    },
  });

  return NextResponse.json({ success: true });
}
