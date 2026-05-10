import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import {
  TicketPriority,
  TicketStatus,
} from "@/app/generated/prisma/enums";

type TicketRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type UpdateTicketPayload = {
  subject?: string;
  previewText?: string | null;
  requesterName?: string | null;
  requesterEmail?: string | null;
  status?: keyof typeof TicketStatus;
  priority?: keyof typeof TicketPriority;
  assigneeId?: string | null;
  assignToMe?: boolean;
  inboxId?: string | null;
  tagIds?: string[];
};

async function createTicketLog(data: {
  workspaceId: string;
  ticketId: string;
  action: string;
  summary: string;
}) {
  await prisma.automationLog.create({
    data: {
      workspaceId: data.workspaceId,
      ticketId: data.ticketId,
      action: data.action,
      status: "SUCCESS",
      summary: data.summary,
    },
  });
}

async function mapTicketResponse(ticketId: string, workspaceId: string) {
  return prisma.ticket.findFirst({
    where: {
      id: ticketId,
      workspaceId,
    },
    include: {
      inbox: true,
      assignee: true,
      createdBy: true,
      ticketTags: {
        include: {
          tag: true,
        },
      },
      messages: {
        orderBy: {
          createdAt: "asc",
        },
      },
      logs: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}

export async function GET(
  _request: Request,
  context: TicketRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const ticket = await mapTicketResponse(id, session.user.workspaceId);

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  return NextResponse.json({ ticket });
}

export async function PATCH(
  request: Request,
  context: TicketRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as UpdateTicketPayload;

  const existingTicket = await prisma.ticket.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      priority: true,
      assigneeId: true,
    },
  });

  if (!existingTicket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  let assigneeId = existingTicket.assigneeId;

  if (body.assignToMe) {
    assigneeId = session.user.id;
  } else if (body.assigneeId !== undefined) {
    if (body.assigneeId === null || body.assigneeId === "") {
      assigneeId = null;
    } else {
      const assignee = await prisma.user.findFirst({
        where: {
          id: body.assigneeId,
          workspaceId: session.user.workspaceId,
          isActive: true,
        },
        select: {
          id: true,
        },
      });

      if (!assignee) {
        return NextResponse.json(
          { error: "Selected assignee was not found in this workspace." },
          { status: 404 },
        );
      }

      assigneeId = assignee.id;
    }
  }

  let inboxId = body.inboxId;

  if (body.inboxId) {
    const inbox = await prisma.inbox.findFirst({
      where: {
        id: body.inboxId,
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!inbox) {
      return NextResponse.json(
        { error: "Selected inbox was not found in this workspace." },
        { status: 404 },
      );
    }

    inboxId = inbox.id;
  }

  if (body.tagIds) {
    const tags = await prisma.tag.findMany({
      where: {
        id: {
          in: body.tagIds,
        },
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (tags.length !== body.tagIds.length) {
      return NextResponse.json(
        { error: "One or more selected tags are invalid for this workspace." },
        { status: 400 },
      );
    }
  }

  const ticket = await prisma.ticket.update({
    where: {
      id,
    },
    data: {
      subject: body.subject?.trim() || undefined,
      previewText:
        body.previewText === undefined ? undefined : body.previewText?.trim() || null,
      requesterName:
        body.requesterName === undefined
          ? undefined
          : body.requesterName?.trim() || null,
      requesterEmail:
        body.requesterEmail === undefined
          ? undefined
          : body.requesterEmail?.trim().toLowerCase() || null,
      status:
        body.status && body.status in TicketStatus ? body.status : undefined,
      priority:
        body.priority && body.priority in TicketPriority
          ? body.priority
          : undefined,
      assigneeId,
      inboxId: body.inboxId === undefined ? undefined : inboxId || null,
      ticketTags: body.tagIds
        ? {
            deleteMany: {},
            create: body.tagIds.map((tagId) => ({
              tagId,
            })),
          }
        : undefined,
    },
    include: {
      inbox: true,
      assignee: true,
      createdBy: true,
      ticketTags: {
        include: {
          tag: true,
        },
      },
      messages: {
        orderBy: {
          createdAt: "asc",
        },
      },
      logs: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  const logParts: string[] = [];

  if (body.assignToMe) {
    logParts.push("Ticket assigned to current user.");
  }

  if (body.status && body.status !== existingTicket.status) {
    logParts.push(`Status changed to ${body.status.toLowerCase().replaceAll("_", " ")}.`);
  }

  if (body.priority && body.priority !== existingTicket.priority) {
    logParts.push(
      `Priority changed to ${body.priority.toLowerCase().replaceAll("_", " ")}.`,
    );
  }

  if (body.tagIds) {
    logParts.push("Ticket tags updated.");
  }

  if (body.subject || body.previewText !== undefined || body.requesterName !== undefined) {
    logParts.push("Ticket details updated.");
  }

  if (logParts.length > 0) {
    await createTicketLog({
      workspaceId: session.user.workspaceId,
      ticketId: id,
      action: "TICKET_UPDATE",
      summary: logParts.join(" "),
    });
  }

  return NextResponse.json({ ticket });
}

export async function DELETE(
  _request: Request,
  context: TicketRouteContext,
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;

  const ticket = await prisma.ticket.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  await prisma.ticket.delete({
    where: {
      id,
    },
  });

  return NextResponse.json({ success: true });
}
