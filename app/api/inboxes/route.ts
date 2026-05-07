import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type InboxPayload = {
  id?: string;
  name?: string;
  emailPrefix?: string;
  senderEmail?: string;
  autoReplyEnabled?: boolean;
  ticketPrefix?: string;
  assignedAgentId?: string | null;
};

function cleanPrefix(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const emailPrefix = searchParams.get("emailPrefix");

  if (emailPrefix) {
    const cleaned = cleanPrefix(emailPrefix);

    if (!cleaned) {
      return NextResponse.json(
        { isAvailable: false, message: "Please enter a valid inbox prefix." },
        { status: 200 },
      );
    }

    const existing = await prisma.inbox.findFirst({
      where: {
        emailPrefix: cleaned,
        workspaceId: {
          not: session.user.workspaceId,
        },
      },
      select: {
        id: true,
      },
    });

    return NextResponse.json({
      isAvailable: !existing,
      message: existing ? "This inbox address is already taken." : "Available.",
    });
  }

  const inboxes = await prisma.inbox.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return NextResponse.json({ inboxes });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as InboxPayload;
  const name = body.name?.trim();
  const emailPrefix = body.emailPrefix ? cleanPrefix(body.emailPrefix) : "";

  if (!name || !emailPrefix) {
    return NextResponse.json(
      { error: "Inbox name and email address are required." },
      { status: 400 },
    );
  }

  const duplicate = await prisma.inbox.findFirst({
    where: {
      emailPrefix,
      id: body.id
        ? {
            not: body.id,
          }
        : undefined,
    },
    select: {
      id: true,
    },
  });

  if (duplicate) {
    return NextResponse.json(
      { error: "This inbox email address is already in use." },
      { status: 409 },
    );
  }

  const data = {
    workspaceId: session.user.workspaceId,
    name,
    emailPrefix,
    ticketPrefix:
      body.ticketPrefix?.trim().toUpperCase() ||
      name.slice(0, 2).toUpperCase() ||
      "AD",
    autoReplyEnabled: body.autoReplyEnabled ?? true,
    senderEmail: body.senderEmail?.trim().toLowerCase() || session.user.email,
  };

  let inbox;

  if (body.id) {
    const existingInbox = await prisma.inbox.findFirst({
      where: {
        id: body.id,
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!existingInbox) {
      return NextResponse.json(
        { error: "Inbox not found in this workspace." },
        { status: 404 },
      );
    }

    inbox = await prisma.inbox.update({
      where: {
        id: body.id,
      },
      data,
    });
  } else {
    inbox = await prisma.inbox.create({
      data,
    });
  }

  if (body.assignedAgentId) {
    const assignedAgent = await prisma.aIAgent.findFirst({
      where: {
        id: body.assignedAgentId,
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (assignedAgent) {
      await prisma.aIAgent.updateMany({
        where: {
          workspaceId: session.user.workspaceId,
          inboxId: inbox.id,
          id: {
            not: assignedAgent.id,
          },
        },
        data: {
          inboxId: null,
        },
      });

      await prisma.aIAgent.update({
        where: {
          id: assignedAgent.id,
        },
        data: {
          inboxId: inbox.id,
        },
      });
    }
  } else if (body.id) {
    await prisma.aIAgent.updateMany({
      where: {
        workspaceId: session.user.workspaceId,
        inboxId: inbox.id,
      },
      data: {
        inboxId: null,
      },
    });
  }

  return NextResponse.json({ inbox });
}
