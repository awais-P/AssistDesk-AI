import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type TagPayload = {
  id?: unknown;
  name?: unknown;
  color?: unknown;
};

const TAG_NAME_MAX_LENGTH = 40;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as TagPayload;
  const id = typeof body.id === "string" && body.id ? body.id : null;
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Tag name is required." }, { status: 400 });
  }

  if (name.length > TAG_NAME_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Tag names can be at most ${TAG_NAME_MAX_LENGTH} characters. Try a shorter name.` },
      { status: 400 },
    );
  }

  const color =
    typeof body.color === "string" && body.color.trim() ? body.color.trim() : "#f97316";

  if (!HEX_COLOR_PATTERN.test(color)) {
    return NextResponse.json(
      { error: "Tag color must be a hex color such as #22c55e. Pick one of the colors shown." },
      { status: 400 },
    );
  }

  try {
    let tag;

    if (id) {
      const existingTag = await prisma.tag.findFirst({
        where: {
          id,
          workspaceId: session.user.workspaceId,
        },
        select: {
          id: true,
        },
      });

      if (!existingTag) {
        return NextResponse.json(
          { error: "This tag no longer exists. Refresh the page to see the latest tags." },
          { status: 404 },
        );
      }

      tag = await prisma.tag.update({
        where: {
          id,
        },
        data: {
          name,
          color: color.toLowerCase(),
        },
        select: { id: true, name: true, color: true },
      });
    } else {
      tag = await prisma.tag.create({
        data: {
          workspaceId: session.user.workspaceId,
          name,
          color: color.toLowerCase(),
        },
        select: { id: true, name: true, color: true },
      });
    }

    return NextResponse.json({ tag });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A tag with this name already exists." },
        { status: 409 },
      );
    }

    throw error;
  }
}
