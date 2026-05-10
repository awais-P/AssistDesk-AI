import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type CannedResponsePayload = {
  id?: string;
  title?: string;
  body?: string;
};

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as CannedResponsePayload;
  const title = body.title?.trim();
  const content = body.body?.trim();

  if (!title || !content) {
    return NextResponse.json(
      { error: "Response name and content are required." },
      { status: 400 },
    );
  }

  let cannedResponse;

  if (body.id) {
    const existing = await prisma.cannedResponse.findFirst({
      where: {
        id: body.id,
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
        id: body.id,
      },
      data: {
        title,
        body: content,
      },
    });
  } else {
    cannedResponse = await prisma.cannedResponse.create({
      data: {
        workspaceId: session.user.workspaceId,
        title,
        body: content,
      },
    });
  }

  return NextResponse.json({ cannedResponse });
}
