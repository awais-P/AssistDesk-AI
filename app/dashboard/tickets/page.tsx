import { redirect } from "next/navigation";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  TicketPriority,
  TicketSource,
  TicketStatus,
} from "@/app/generated/prisma/enums";
import {
  TicketsClient,
  type TicketFilters,
  type TicketSort,
} from "@/src/components/dashboard/tickets-client";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type TicketsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const pageSizes = new Set([10, 20, 50]);
const sortValues = new Set<string>(["newest", "oldest", "updated", "priority"]);
const statusValues = new Set<string>(Object.values(TicketStatus));
const priorityValues = new Set<string>(Object.values(TicketPriority));
const sourceValues = new Set<string>(Object.values(TicketSource));

const orderBy: Record<TicketSort, Prisma.TicketOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }, { ticketNumber: "desc" }],
  oldest: [{ createdAt: "asc" }, { ticketNumber: "asc" }],
  updated: [{ updatedAt: "desc" }, { ticketNumber: "desc" }],
  // Postgres orders enums by declaration (LOW..URGENT), so desc puts URGENT first.
  priority: [{ priority: "desc" }, { createdAt: "desc" }],
};

function firstParam(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function resolveTimeZone(timeZone: string | null | undefined) {
  if (!timeZone) {
    return "UTC";
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function initialsOf(name: string | null | undefined) {
  return (name ?? "UN")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
}

export default async function TicketsPage({ searchParams }: TicketsPageProps) {
  const [session, params] = await Promise.all([getCurrentSession(), searchParams]);

  if (!session) {
    redirect("/login");
  }

  const workspaceId = session.user.workspaceId;
  const requestedPageSize = Number(firstParam(params.pageSize));
  const pageSize = pageSizes.has(requestedPageSize) ? requestedPageSize : 20;
  const requestedSort = firstParam(params.sort);
  const sort = (sortValues.has(requestedSort) ? requestedSort : "newest") as TicketSort;
  const status = firstParam(params.status);
  const priority = firstParam(params.priority);
  const source = firstParam(params.source);

  const filters: TicketFilters = {
    q: firstParam(params.q).slice(0, 200),
    status: statusValues.has(status) ? status : "",
    priority: priorityValues.has(priority) ? priority : "",
    source: sourceValues.has(source) ? source : "",
    assignee: firstParam(params.assignee),
    inbox: firstParam(params.inbox),
    tag: firstParam(params.tag),
  };

  const where: Prisma.TicketWhereInput = { workspaceId };

  if (filters.q) {
    const ticketNumber = /^#?\d{1,9}$/.test(filters.q)
      ? Number(filters.q.replace("#", ""))
      : null;

    where.OR = [
      { subject: { contains: filters.q, mode: "insensitive" } },
      { previewText: { contains: filters.q, mode: "insensitive" } },
      { requesterName: { contains: filters.q, mode: "insensitive" } },
      { requesterEmail: { contains: filters.q, mode: "insensitive" } },
      ...(ticketNumber !== null ? [{ ticketNumber }] : []),
    ];
  }

  if (filters.status) {
    where.status = filters.status as TicketStatus;
  }

  if (filters.priority) {
    where.priority = filters.priority as TicketPriority;
  }

  if (filters.source) {
    where.source = filters.source as TicketSource;
  }

  if (filters.assignee) {
    where.assigneeId = filters.assignee === "unassigned" ? null : filters.assignee;
  }

  if (filters.inbox) {
    where.inboxId = filters.inbox === "unassigned" ? null : filters.inbox;
  }

  if (filters.tag) {
    where.ticketTags = { some: { tagId: filters.tag } };
  }

  const [total, users, inboxes, tags, settings] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.user.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    prisma.inbox.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.tag.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.workspaceSetting.findUnique({
      where: { workspaceId },
      select: { timezone: true },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = Math.floor(Number(firstParam(params.page)));
  const page = Math.min(
    Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageCount,
  );

  const tickets = await prisma.ticket.findMany({
    where,
    select: {
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
      inbox: {
        select: {
          name: true,
        },
      },
      assignee: {
        select: {
          id: true,
          fullName: true,
        },
      },
      ticketTags: {
        select: {
          tag: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: orderBy[sort],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return (
    <TicketsClient
      tickets={tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        previewText: ticket.previewText,
        requesterName: ticket.requesterName,
        requesterEmail: ticket.requesterEmail,
        source: ticket.source,
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.createdAt.toISOString(),
        inboxName: ticket.inbox?.name ?? "Unassigned",
        assigneeId: ticket.assignee?.id ?? null,
        assigneeName: ticket.assignee?.fullName ?? "Unassigned",
        assigneeInitials: initialsOf(ticket.assignee?.fullName),
        tags: ticket.ticketTags.map((ticketTag) => ticketTag.tag.name),
      }))}
      total={total}
      page={page}
      pageSize={pageSize}
      sort={sort}
      filters={filters}
      users={users}
      inboxes={inboxes}
      tags={tags}
      timeZone={resolveTimeZone(settings?.timezone)}
      currentUser={{
        id: session.user.id,
        fullName: session.user.fullName,
      }}
    />
  );
}
