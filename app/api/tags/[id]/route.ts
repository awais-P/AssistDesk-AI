import { requireRole } from "@/src/lib/rbac";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type TagRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(_request: Request, context: TagRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }


  const forbidden = requireRole(session.user, "MANAGER");


  if (forbidden) {

    return forbidden;

  }

  const { id } = await context.params;

  const tag = await prisma.tag.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!tag) {
    return NextResponse.json({ error: "Tag not found." }, { status: 404 });
  }

  await prisma.tag.delete({
    where: {
      id,
    },
  });

  return NextResponse.json({ success: true });
}
