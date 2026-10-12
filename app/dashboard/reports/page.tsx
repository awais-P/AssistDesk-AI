import { redirect } from "next/navigation";
import {
  ReportsWorkspace,
  type ReportRange,
} from "@/src/components/dashboard/reports-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

const reportRanges: ReportRange[] = [7, 30, 90];
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;
const INTERNAL_NOTE_MARKER = "[[INTERNAL_NOTE]]";
const AI_REPLY_ACTIONS = [
  "CHATBOT_REPLY",
  "SLACK_REPLY",
  "WHATSAPP_REPLY",
  "AI_RESPONSE",
  "PLAYGROUND_TEST",
];

type ReportsPageProps = {
  searchParams: Promise<{
    range?: string | string[];
  }>;
};

function parseRange(value: string | string[] | undefined): ReportRange {
  const parsed = Number(Array.isArray(value) ? value[0] : value);

  return reportRanges.find((range) => range === parsed) ?? 30;
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const [session, params] = await Promise.all([getCurrentSession(), searchParams]);

  if (!session) {
    redirect("/login");
  }

  const workspaceId = session.user.workspaceId;
  const range = parseRange(params.range);
  const since = new Date(Date.now() - range * DAY_MS);

  const [
    ticketCount,
    tickets,
    chatSessionCount,
    chatSessions,
    chatMessagesBySender,
    aiTotals,
    aiTimedTotals,
    aiFallbackCount,
    aiByAction,
  ] = await Promise.all([
    prisma.ticket.count({ where: { workspaceId, createdAt: { gte: since } } }),
    prisma.ticket.findMany({
      where: { workspaceId, createdAt: { gte: since } },
      select: {
        status: true,
        priority: true,
        source: true,
        createdAt: true,
        updatedAt: true,
        assignee: { select: { id: true, fullName: true } },
        // Customer-facing replies only: internal notes are not a response.
        messages: {
          where: {
            sender: { in: ["AGENT", "AI"] },
            NOT: { content: { startsWith: INTERNAL_NOTE_MARKER } },
          },
          select: { sender: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    }),
    prisma.chatSession.count({ where: { workspaceId, startedAt: { gte: since } } }),
    prisma.chatSession.findMany({
      where: { workspaceId, startedAt: { gte: since } },
      select: { channel: true, status: true },
      orderBy: { startedAt: "desc" },
      take: MAX_ROWS,
    }),
    prisma.chatMessage.groupBy({
      by: ["sender"],
      where: { session: { workspaceId }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.automationLog.aggregate({
      where: { workspaceId, action: { in: AI_REPLY_ACTIONS }, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { tokens: true },
    }),
    // Older logs have no measured duration (0 ms), so they are left out of the average.
    prisma.automationLog.aggregate({
      where: {
        workspaceId,
        action: { in: AI_REPLY_ACTIONS },
        createdAt: { gte: since },
        durationMs: { gt: 0 },
      },
      _avg: { durationMs: true },
    }),
    prisma.automationLog.count({
      where: {
        workspaceId,
        action: { in: AI_REPLY_ACTIONS },
        createdAt: { gte: since },
        status: "FALLBACK",
      },
    }),
    prisma.automationLog.groupBy({
      by: ["action"],
      where: { workspaceId, action: { in: AI_REPLY_ACTIONS }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const firstResponseTimes: number[] = [];
  let repliedTickets = 0;
  let aiResolvedTickets = 0;

  for (const ticket of tickets) {
    const firstReply = ticket.messages[0];

    if (!firstReply) {
      continue;
    }

    repliedTickets += 1;
    firstResponseTimes.push(firstReply.createdAt.getTime() - ticket.createdAt.getTime());

    const hasAiReply = ticket.messages.some((message) => message.sender === "AI");
    const hasAgentReply = ticket.messages.some((message) => message.sender === "AGENT");

    if (hasAiReply && !hasAgentReply) {
      aiResolvedTickets += 1;
    }
  }

  const resolvedTickets = tickets.filter(
    (ticket) => ticket.status === "RESOLVED" || ticket.status === "CLOSED",
  );
  const resolutionTimes = resolvedTickets.map(
    (ticket) => ticket.updatedAt.getTime() - ticket.createdAt.getTime(),
  );

  // DATA-09: only real team members are ranked; unassigned tickets are reported separately.
  const agentMap = new Map<string, { name: string; handled: number; resolved: number }>();

  for (const ticket of tickets) {
    if (!ticket.assignee) {
      continue;
    }

    const entry = agentMap.get(ticket.assignee.id) ?? {
      name: ticket.assignee.fullName,
      handled: 0,
      resolved: 0,
    };

    entry.handled += 1;

    if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") {
      entry.resolved += 1;
    }

    agentMap.set(ticket.assignee.id, entry);
  }

  const topAgents = [...agentMap.values()]
    .sort((first, second) => second.handled - first.handled)
    .slice(0, 8);

  const aiReplyCount = aiTotals._count._all;

  return (
    <ReportsWorkspace
      range={range}
      ranges={reportRanges}
      tickets={{
        total: ticketCount,
        sampled: ticketCount > tickets.length ? tickets.length : null,
        byStatus: countBy(tickets, (ticket) => ticket.status),
        byPriority: countBy(tickets, (ticket) => ticket.priority),
        bySource: countBy(tickets, (ticket) => ticket.source),
        avgFirstResponseMs: average(firstResponseTimes),
        respondedCount: repliedTickets,
        avgResolutionMs: average(resolutionTimes),
        resolvedCount: resolvedTickets.length,
        aiResolvedRate: repliedTickets > 0 ? aiResolvedTickets / repliedTickets : null,
        aiResolvedCount: aiResolvedTickets,
        unassignedCount: tickets.filter((ticket) => !ticket.assignee).length,
        topAgents,
      }}
      chats={{
        total: chatSessionCount,
        sampled: chatSessionCount > chatSessions.length ? chatSessions.length : null,
        byChannel: countBy(chatSessions, (chatSession) => chatSession.channel),
        escalatedCount: chatSessions.filter((chatSession) => chatSession.status === "ESCALATED")
          .length,
        messagesBySender: Object.fromEntries(
          chatMessagesBySender
            .filter((group) => group.sender !== "SYSTEM")
            .map((group) => [group.sender, group._count._all]),
        ),
      }}
      ai={{
        replyCount: aiReplyCount,
        avgDurationMs: aiTimedTotals._avg.durationMs,
        fallbackRate: aiReplyCount > 0 ? aiFallbackCount / aiReplyCount : null,
        fallbackCount: aiFallbackCount,
        totalTokens: aiTotals._sum.tokens ?? 0,
        byAction: Object.fromEntries(aiByAction.map((group) => [group.action, group._count._all])),
      }}
    />
  );
}
