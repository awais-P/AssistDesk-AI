import { redirect } from "next/navigation";
import type { Prisma } from "@/app/generated/prisma/client";
import { LogsWorkspace } from "@/src/components/dashboard/logs-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

const PAGE_SIZE = 25;

type LogsPageProps = {
  searchParams: Promise<{
    page?: string | string[];
    action?: string | string[];
    status?: string | string[];
    q?: string | string[];
  }>;
};

function firstParam(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const [session, params] = await Promise.all([getCurrentSession(), searchParams]);

  if (!session) {
    redirect("/login");
  }

  const workspaceId = session.user.workspaceId;
  const action = firstParam(params.action).slice(0, 64);
  const status = firstParam(params.status).slice(0, 64);
  const query = firstParam(params.q).slice(0, 120);
  const requestedPage = Math.max(1, Number.parseInt(firstParam(params.page), 10) || 1);

  const where: Prisma.AutomationLogWhereInput = { workspaceId };

  if (action) {
    where.action = action;
  }

  if (status) {
    where.status = status;
  }

  if (query) {
    const ticketNumberMatch = /^#?(\d{1,9})$/.exec(query);
    const or: Prisma.AutomationLogWhereInput[] = [
      { summary: { contains: query, mode: "insensitive" } },
    ];

    if (ticketNumberMatch) {
      or.push({ ticket: { ticketNumber: Number(ticketNumberMatch[1]) } });
    }

    where.OR = or;
  }

  const [totalCount, actionOptions, statusOptions] = await Promise.all([
    prisma.automationLog.count({ where }),
    prisma.automationLog.findMany({
      where: { workspaceId },
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
    prisma.automationLog.findMany({
      where: { workspaceId },
      distinct: ["status"],
      select: { status: true },
      orderBy: { status: "asc" },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const logs = await prisma.automationLog.findMany({
    where,
    select: {
      id: true,
      action: true,
      status: true,
      model: true,
      tokens: true,
      durationMs: true,
      summary: true,
      createdAt: true,
      ticketId: true,
      ticket: {
        select: {
          ticketNumber: true,
        },
      },
      agent: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  return (
    <LogsWorkspace
      logs={logs.map((log) => ({
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        action: log.action,
        status: log.status,
        model: log.model,
        tokens: log.tokens,
        durationMs: log.durationMs,
        summary: log.summary,
        ticketId: log.ticket ? log.ticketId : null,
        ticketNumber: log.ticket?.ticketNumber ?? null,
        agentName: log.agent?.name ?? null,
      }))}
      filters={{ action, status, query }}
      actionOptions={actionOptions.map((option) => option.action)}
      statusOptions={statusOptions.map((option) => option.status)}
      pagination={{ page, pageSize: PAGE_SIZE, totalCount, totalPages }}
    />
  );
}
