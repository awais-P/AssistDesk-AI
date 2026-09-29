import { requireRole } from "@/src/lib/rbac";
import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { getCurrentSession, isValidEmail } from "@/src/lib/auth";
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
  subject?: unknown;
  previewText?: unknown;
  requesterName?: unknown;
  requesterEmail?: unknown;
  status?: unknown;
  priority?: unknown;
  assigneeId?: unknown;
  assignToMe?: unknown;
  inboxId?: unknown;
  tagIds?: unknown;
};

const statusValues = new Set<string>(Object.values(TicketStatus));
const priorityValues = new Set<string>(Object.values(TicketPriority));

/**
 * Only the fields the dashboard needs: never `include` whole users or inboxes here,
 * those rows carry password hashes and SMTP passwords.
 */
const ticketDetailSelect = {
  id: true,
  ticketNumber: true,
  subject: true,
  previewText: true,
  requesterName: true,
  requesterEmail: true,
  source: true,
  status: true,
  priority: true,
  createdAt: true,
  updatedAt: true,
  inbox: {
    select: {
      id: true,
      name: true,
      emailPrefix: true,
    },
  },
  assignee: {
    select: {
      id: true,
      fullName: true,
      email: true,
    },
  },
  ticketTags: {
    select: {
      tag: {
        select: {
          id: true,
          name: true,
          color: true,
        },
      },
    },
  },
  messages: {
    select: {
      id: true,
      sender: true,
      content: true,
      authorName: true,
      deliveryStatus: true,
      deliveryError: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  },
  logs: {
    select: {
      id: true,
      action: true,
      status: true,
      model: true,
      tokens: true,
      durationMs: true,
      summary: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  },
} satisfies Prisma.TicketSelect;

function formatEnumValue(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/** undefined = not sent, null = clear the field, string = trimmed new value. */
function nullableText(value: unknown): string | null | undefined | false {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return false;
  }

  return value.trim() || null;
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
  const ticket = await prisma.ticket.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: ticketDetailSelect,
  });

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
  let body: UpdateTicketPayload;

  try {
    body = (await request.json()) as UpdateTicketPayload;
  } catch {
    return badRequest("Invalid request body.");
  }

  // Validate everything before writing anything (BUG-20, SEC-23).
  if (
    body.status !== undefined &&
    (typeof body.status !== "string" || !statusValues.has(body.status))
  ) {
    return badRequest("Choose a valid ticket status.");
  }

  if (
    body.priority !== undefined &&
    (typeof body.priority !== "string" || !priorityValues.has(body.priority))
  ) {
    return badRequest("Choose a valid ticket priority.");
  }

  if (body.subject !== undefined && typeof body.subject !== "string") {
    return badRequest("Ticket subject must be text.");
  }

  const previewText = nullableText(body.previewText);
  const requesterName = nullableText(body.requesterName);
  const requesterEmailText = nullableText(body.requesterEmail);

  if (previewText === false || requesterName === false || requesterEmailText === false) {
    return badRequest("Ticket details must be text.");
  }

  const requesterEmail = requesterEmailText?.toLowerCase() ?? requesterEmailText;

  if (requesterEmail && !isValidEmail(requesterEmail)) {
    return badRequest("Enter a valid requester email address.");
  }

  if (
    body.assigneeId !== undefined &&
    body.assigneeId !== null &&
    typeof body.assigneeId !== "string"
  ) {
    return badRequest("Choose a valid assignee.");
  }

  if (
    body.inboxId !== undefined &&
    body.inboxId !== null &&
    typeof body.inboxId !== "string"
  ) {
    return badRequest("Choose a valid inbox.");
  }

  if (
    body.tagIds !== undefined &&
    (!Array.isArray(body.tagIds) ||
      !body.tagIds.every((tagId): tagId is string => typeof tagId === "string"))
  ) {
    return badRequest("Tags must be a list of tag IDs.");
  }

  const tagIds = body.tagIds ? Array.from(new Set(body.tagIds as string[])) : undefined;

  const existingTicket = await prisma.ticket.findFirst({
    where: {
      id,
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
      subject: true,
      previewText: true,
      requesterName: true,
      requesterEmail: true,
      status: true,
      priority: true,
      assigneeId: true,
      inboxId: true,
      ticketTags: {
        select: {
          tagId: true,
        },
      },
    },
  });

  if (!existingTicket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  let assigneeId = existingTicket.assigneeId;
  let assigneeName: string | null = null;

  if (body.assignToMe === true) {
    assigneeId = session.user.id;
    assigneeName = session.user.fullName;
  } else if (body.assigneeId !== undefined) {
    if (body.assigneeId === null || body.assigneeId === "") {
      assigneeId = null;
    } else {
      const assignee = await prisma.user.findFirst({
        where: {
          id: body.assigneeId as string,
          workspaceId: session.user.workspaceId,
          isActive: true,
        },
        select: {
          id: true,
          fullName: true,
        },
      });

      if (!assignee) {
        return NextResponse.json(
          { error: "Selected assignee was not found in this workspace." },
          { status: 404 },
        );
      }

      assigneeId = assignee.id;
      assigneeName = assignee.fullName;
    }
  }

  let inboxId = existingTicket.inboxId;

  if (body.inboxId !== undefined) {
    if (body.inboxId === null || body.inboxId === "") {
      inboxId = null;
    } else {
      const inbox = await prisma.inbox.findFirst({
        where: {
          id: body.inboxId as string,
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
  }

  if (tagIds && tagIds.length > 0) {
    const tagCount = await prisma.tag.count({
      where: {
        id: {
          in: tagIds,
        },
        workspaceId: session.user.workspaceId,
      },
    });

    if (tagCount !== tagIds.length) {
      return badRequest("One or more selected tags are invalid for this workspace.");
    }
  }

  const status = body.status as TicketStatus | undefined;
  const priority = body.priority as TicketPriority | undefined;
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const existingTagIds = new Set(existingTicket.ticketTags.map((item) => item.tagId));
  const tagsChanged =
    tagIds !== undefined &&
    (tagIds.length !== existingTagIds.size ||
      tagIds.some((tagId) => !existingTagIds.has(tagId)));
  const detailsChanged =
    (subject !== "" && subject !== existingTicket.subject) ||
    (previewText !== undefined && previewText !== existingTicket.previewText) ||
    (requesterName !== undefined && requesterName !== existingTicket.requesterName) ||
    (requesterEmail !== undefined && requesterEmail !== existingTicket.requesterEmail);

  const ticket = await prisma.ticket.update({
    where: {
      id,
    },
    data: {
      subject: subject || undefined,
      previewText,
      requesterName,
      requesterEmail,
      status,
      priority,
      assigneeId,
      inboxId,
      ticketTags: tagsChanged
        ? {
            deleteMany: {},
            create: tagIds.map((tagId) => ({
              tagId,
            })),
          }
        : undefined,
    },
    select: ticketDetailSelect,
  });

  // Only describe changes that were actually applied.
  const logParts: string[] = [];

  if (assigneeId !== existingTicket.assigneeId) {
    logParts.push(
      assigneeId ? `Ticket assigned to ${assigneeName ?? "a team member"}.` : "Ticket unassigned.",
    );
  }

  if (status && status !== existingTicket.status) {
    logParts.push(`Status changed to ${formatEnumValue(status)}.`);
  }

  if (priority && priority !== existingTicket.priority) {
    logParts.push(`Priority changed to ${formatEnumValue(priority)}.`);
  }

  if (tagsChanged) {
    logParts.push("Ticket tags updated.");
  }

  if (inboxId !== existingTicket.inboxId) {
    logParts.push("Ticket inbox changed.");
  }

  if (detailsChanged) {
    logParts.push("Ticket details updated.");
  }

  if (logParts.length > 0) {
    await prisma.automationLog.create({
      data: {
        workspaceId: session.user.workspaceId,
        ticketId: id,
        action: "TICKET_UPDATE",
        status: "SUCCESS",
        summary: `${logParts.join(" ")} (by ${session.user.fullName})`,
      },
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

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
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
