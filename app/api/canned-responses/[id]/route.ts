import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type CannedResponseRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(
  _request: Request,
  context: CannedResponseRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;

  const cannedResponse = await prisma.cannedResponse.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!cannedResponse) {
    return NextResponse.json(
      { error: "Canned response not found." },
      { status: 404 },
    );
  }

  await prisma.cannedResponse.delete({
    where: {
      id,
    },
  });

  return NextResponse.json({ success: true });
}
