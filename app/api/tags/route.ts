import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type TagPayload = {
  id?: string;
  name?: string;
  color?: string;
};

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as TagPayload;
  const name = body.name?.trim();

  if (!name) {
    return NextResponse.json({ error: "Tag name is required." }, { status: 400 });
  }

  const color = body.color?.trim() || "#f97316";

  let tag;

  if (body.id) {
    const existingTag = await prisma.tag.findFirst({
      where: {
        id: body.id,
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!existingTag) {
      return NextResponse.json({ error: "Tag not found." }, { status: 404 });
    }

    tag = await prisma.tag.update({
      where: {
        id: body.id,
      },
      data: {
        name,
        color,
      },
    });
  } else {
    tag = await prisma.tag.create({
      data: {
        workspaceId: session.user.workspaceId,
        name,
        color,
      },
    });
  }

  return NextResponse.json({ tag });
}
