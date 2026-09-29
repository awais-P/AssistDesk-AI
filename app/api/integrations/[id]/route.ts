import { requireRole } from "@/src/lib/rbac";
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


  const forbidden = requireRole(session.user, "ADMIN");


  if (forbidden) {

    return forbidden;

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

/** Enable or disable a channel without re-entering its credentials (SRS FR-16.7). */
export async function PATCH(request: Request, context: IntegrationRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }


  const forbidden = requireRole(session.user, "ADMIN");


  if (forbidden) {

    return forbidden;

  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { isActive?: unknown };

  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive must be true or false." }, { status: 400 });
  }

  const result = await prisma.integration.updateMany({
    where: { id, workspaceId: session.user.workspaceId },
    data: { isActive: body.isActive },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Integration not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, isActive: body.isActive });
}
