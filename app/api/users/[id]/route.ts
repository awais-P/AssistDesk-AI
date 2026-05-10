import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type UserRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type UpdateUserPayload = {
  role?: "OWNER" | "ADMIN" | "MANAGER" | "AGENT";
  isActive?: boolean;
};

export async function PATCH(request: Request, context: UserRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as UpdateUserPayload;

  const user = await prisma.user.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const updatedUser = await prisma.user.update({
    where: {
      id,
    },
    data: {
      role: body.role || user.role,
      isActive:
        typeof body.isActive === "boolean" ? body.isActive : user.isActive,
    },
  });

  return NextResponse.json({ user: updatedUser });
}

export async function DELETE(_request: Request, context: UserRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;

  if (id === session.user.id) {
    return NextResponse.json(
      { error: "You cannot delete your own account from this page." },
      { status: 400 },
    );
  }

  const user = await prisma.user.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  await prisma.user.delete({
    where: {
      id,
    },
  });

  return NextResponse.json({ success: true });
}
