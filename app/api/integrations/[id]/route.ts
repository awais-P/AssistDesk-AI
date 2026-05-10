import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type IntegrationRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(
  _request: Request,
  context: IntegrationRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;

  const integration = await prisma.integration.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!integration) {
    return NextResponse.json(
      { error: "Integration not found." },
      { status: 404 },
    );
  }

  await prisma.integration.delete({
    where: {
      id,
    },
  });

  return NextResponse.json({ success: true });
}
