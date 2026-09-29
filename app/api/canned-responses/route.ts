import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type CannedResponsePayload = {
  id?: unknown;
  title?: unknown;
  body?: unknown;
};

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 10000;

const cannedResponseSelect = {
  id: true,
  title: true,
  body: true,
  createdAt: true,
} as const;

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: CannedResponsePayload;

  try {
    body = (await request.json()) as CannedResponsePayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.body === "string" ? body.body.trim() : "";
  const id = typeof body.id === "string" && body.id ? body.id : null;

  if (!title || !content) {
    return NextResponse.json(
      { error: "Response name and content are required." },
      { status: 400 },
    );
  }

  if (title.length > MAX_TITLE_LENGTH || content.length > MAX_BODY_LENGTH) {
    return NextResponse.json(
      {
        error: `Keep the name under ${MAX_TITLE_LENGTH} characters and the content under ${MAX_BODY_LENGTH}.`,
      },
      { status: 400 },
    );
  }

  let cannedResponse;

  if (id) {
    const existing = await prisma.cannedResponse.findFirst({
      where: {
        id,
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Canned response not found." },
        { status: 404 },
      );
    }

    cannedResponse = await prisma.cannedResponse.update({
      where: {
        id,
      },
      data: {
        title,
        body: content,
      },
      select: cannedResponseSelect,
    });
  } else {
    cannedResponse = await prisma.cannedResponse.create({
      data: {
        workspaceId: session.user.workspaceId,
        title,
        body: content,
      },
      select: cannedResponseSelect,
    });
  }

  return NextResponse.json({ cannedResponse });
}
