import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";
import {
  TicketPriority,
  TicketStatus,
} from "@/app/generated/prisma/enums";

type BulkAction = "status" | "priority" | "assign" | "tag" | "delete";

type BulkPayload = {
  ids?: unknown;
  action?: unknown;
  value?: unknown;
};

const MAX_BULK_TICKETS = 100;
const bulkActions = new Set<string>(["status", "priority", "assign", "tag", "delete"]);
const statusValues = new Set<string>(Object.values(TicketStatus));
const priorityValues = new Set<string>(Object.values(TicketPriority));

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

function formatEnumValue(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

/**
 * Applies one change to many tickets from the Tickets page (FR-5.x bulk actions).
 * IDs outside the signed-in user's workspace are silently ignored.
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: BulkPayload;

  try {
    body = (await request.json()) as BulkPayload;
  } catch {
    return badRequest("Invalid request body.");
  }

  if (
    !Array.isArray(body.ids) ||
    !body.ids.every((ticketId): ticketId is string => typeof ticketId === "string")
  ) {
    return badRequest("Select at least one ticket.");
  }

  const ids = Array.from(new Set(body.ids as string[]));

  if (ids.length === 0) {
    return badRequest("Select at least one ticket.");
  }

  if (ids.length > MAX_BULK_TICKETS) {
    return badRequest(`Bulk actions are limited to ${MAX_BULK_TICKETS} tickets at a time.`);
  }

  if (typeof body.action !== "string" || !bulkActions.has(body.action)) {
    return badRequest("Choose a valid bulk action.");
  }

  const action = body.action as BulkAction;
  const value = typeof body.value === "string" ? body.value.trim() : "";

  if (action === "delete") {
    const forbidden = requireRole(session.user, "MANAGER");

    if (forbidden) {
      return forbidden;
    }
  }

  const workspaceId = session.user.workspaceId;
  const tickets = await prisma.ticket.findMany({
    where: {
      id: {
        in: ids,
      },
      workspaceId,
    },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      priority: true,
      assigneeId: true,
    },
  });

  if (tickets.length === 0) {
    return NextResponse.json(
      { error: "None of the selected tickets were found in this workspace." },
      { status: 404 },
    );
  }

  const actor = session.user.fullName;

  function logRows(ticketIds: string[], summary: string) {
    return ticketIds.map((ticketId) => ({
      workspaceId,
      ticketId,
      action: "BULK_UPDATE",
      status: "SUCCESS",
      summary,
    }));
  }

  if (action === "status" || action === "priority") {
    const allowed = action === "status" ? statusValues : priorityValues;

    if (!allowed.has(value)) {
      return badRequest(`Choose a valid ticket ${action}.`);
    }

    const affectedIds = tickets
      .filter((ticket) => ticket[action] !== value)
      .map((ticket) => ticket.id);

    if (affectedIds.length > 0) {
      await prisma.$transaction([
        prisma.ticket.updateMany({
          where: { id: { in: affectedIds }, workspaceId },
          data:
            action === "status"
              ? { status: value as TicketStatus }
              : { priority: value as TicketPriority },
        }),
        prisma.automationLog.createMany({
          data: logRows(
            affectedIds,
            `Bulk update by ${actor}: ${action} changed to ${formatEnumValue(value)}.`,
          ),
        }),
      ]);
    }

    return NextResponse.json({ updated: affectedIds.length });
  }

  if (action === "assign") {
    let assigneeId: string | null = null;
    let assigneeName = "";

    if (value && value !== "unassigned") {
      const assignee = await prisma.user.findFirst({
        where: {
          id: value,
          workspaceId,
          isActive: true,
        },
        select: {
          id: true,
          fullName: true,
        },
      });

      if (!assignee) {
        return badRequest("Selected assignee was not found in this workspace.");
      }

      assigneeId = assignee.id;
      assigneeName = assignee.fullName;
    }

    const affectedIds = tickets
      .filter((ticket) => ticket.assigneeId !== assigneeId)
      .map((ticket) => ticket.id);

    if (affectedIds.length > 0) {
      await prisma.$transaction([
        prisma.ticket.updateMany({
          where: { id: { in: affectedIds }, workspaceId },
          data: { assigneeId },
        }),
        prisma.automationLog.createMany({
          data: logRows(
            affectedIds,
            assigneeId
              ? `Bulk update by ${actor}: ticket assigned to ${assigneeName}.`
              : `Bulk update by ${actor}: ticket unassigned.`,
          ),
        }),
      ]);
    }

    return NextResponse.json({ updated: affectedIds.length });
  }

  if (action === "tag") {
    const tag = value
      ? await prisma.tag.findFirst({
          where: {
            id: value,
            workspaceId,
          },
          select: {
            id: true,
            name: true,
          },
        })
      : null;

    if (!tag) {
      return badRequest("Selected tag was not found in this workspace.");
    }

    const alreadyTagged = await prisma.ticketTag.findMany({
      where: {
        tagId: tag.id,
        ticketId: {
          in: tickets.map((ticket) => ticket.id),
        },
      },
      select: {
        ticketId: true,
      },
    });
    const taggedIds = new Set(alreadyTagged.map((item) => item.ticketId));
    const affectedIds = tickets
      .filter((ticket) => !taggedIds.has(ticket.id))
      .map((ticket) => ticket.id);

    if (affectedIds.length > 0) {
      await prisma.$transaction([
        prisma.ticketTag.createMany({
          data: affectedIds.map((ticketId) => ({ ticketId, tagId: tag.id })),
          skipDuplicates: true,
        }),
        prisma.automationLog.createMany({
          data: logRows(affectedIds, `Bulk update by ${actor}: tag "${tag.name}" added.`),
        }),
      ]);
    }

    return NextResponse.json({ updated: affectedIds.length });
  }

  // delete: the log rows outlive the tickets (ticketId is set to null on delete),
  // so the summary carries the ticket number.
  const affectedIds = tickets.map((ticket) => ticket.id);

  await prisma.$transaction([
    prisma.automationLog.createMany({
      data: tickets.map((ticket) => ({
        workspaceId,
        ticketId: ticket.id,
        action: "BULK_UPDATE",
        status: "SUCCESS",
        summary: `Bulk update by ${actor}: ticket #${ticket.ticketNumber} deleted.`,
      })),
    }),
    prisma.ticket.deleteMany({
      where: { id: { in: affectedIds }, workspaceId },
    }),
  ]);

  return NextResponse.json({ updated: affectedIds.length });
}
