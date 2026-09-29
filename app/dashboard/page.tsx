import { redirect } from "next/navigation";
import {
  OverviewWorkspace,
  type OverviewAgentRow,
} from "@/src/components/dashboard/overview-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { listNotifications } from "@/src/lib/notifications";
import { countOnlineOperators } from "@/src/lib/presence";
import { prisma } from "@/src/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Customer-facing AI replies. Playground tests (PLAYGROUND_TEST) and AI drafts for
 * human agents are deliberately left out so the numbers reflect real traffic.
 */
const AI_REPLY_ACTIONS = [
  "CHATBOT_REPLY",
  "WHATSAPP_REPLY",
  "SLACK_REPLY",
  "EMAIL_REPLY",
  "VOICE_REPLY",
  "AI_RESPONSE",
];

type DashboardOverviewPageProps = {
  searchParams: Promise<{
    range?: string | string[];
  }>;
};

type ReplyStats = {
  replies: number;
  fallbacks: number;
  tokens: number;
  durationMs: number;
};

function emptyStats(): ReplyStats {
  return { replies: 0, fallbacks: 0, tokens: 0, durationMs: 0 };
}

function toAgentRow(
  id: string | null,
  name: string,
  status: string | null,
  stats: ReplyStats,
): OverviewAgentRow {
  return {
    id,
    name,
    status,
    replies: stats.replies,
    tokens: stats.tokens,
    avgLatencyMs: stats.replies > 0 ? stats.durationMs / stats.replies : null,
    fallbackRate: stats.replies > 0 ? stats.fallbacks / stats.replies : null,
  };
}

export default async function DashboardOverviewPage({
  searchParams,
}: DashboardOverviewPageProps) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const { range } = await searchParams;
  const rangeDays = range === "30" ? 30 : 7;
  const workspaceId = session.user.workspaceId;
  const now = Date.now();
  const rangeStart = new Date(now - rangeDays * DAY_MS);
  const activeChatWindowStart = new Date(now - DAY_MS);

  const [
    replyGroups,
    agents,
    openTickets,
    activeChats,
    waitingChats,
    teamOnline,
    teamSize,
    knowledgeGroups,
    knowledgeWarnings,
    alerts,
  ] = await Promise.all([
    prisma.automationLog.groupBy({
      by: ["agentId", "status"],
      where: {
        workspaceId,
        action: { in: AI_REPLY_ACTIONS },
        createdAt: { gte: rangeStart },
      },
      _count: { _all: true },
      _sum: { tokens: true, durationMs: true },
    }),
    prisma.aIAgent.findMany({
      where: { workspaceId },
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    prisma.ticket.count({
      where: { workspaceId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    }),
    prisma.chatSession.count({
      where: {
        workspaceId,
        status: { in: ["ACTIVE", "ESCALATED"] },
        updatedAt: { gte: activeChatWindowStart },
      },
    }),
    prisma.chatSession.count({
      where: { workspaceId, status: "ESCALATED" },
    }),
    countOnlineOperators(workspaceId),
    prisma.user.count({
      where: { workspaceId, isActive: true },
    }),
    prisma.knowledgeSource.groupBy({
      by: ["status"],
      where: { workspaceId, status: { not: "DELETED" } },
      _count: { _all: true },
    }),
    prisma.knowledgeSource.count({
      where: { workspaceId, status: "SYNCED", processingError: { not: null } },
    }),
    listNotifications(workspaceId, session.user.id, 8),
  ]);

  const totals = emptyStats();
  const statsByAgent = new Map<string | null, ReplyStats>();

  for (const group of replyGroups) {
    const stats = statsByAgent.get(group.agentId) ?? emptyStats();
    const count = group._count._all;
    const tokens = group._sum.tokens ?? 0;
    const durationMs = group._sum.durationMs ?? 0;
    const fallbacks = group.status === "FALLBACK" ? count : 0;

    stats.replies += count;
    stats.fallbacks += fallbacks;
    stats.tokens += tokens;
    stats.durationMs += durationMs;
    statsByAgent.set(group.agentId, stats);

    totals.replies += count;
    totals.fallbacks += fallbacks;
    totals.tokens += tokens;
    totals.durationMs += durationMs;
  }

  const agentRows = agents
    .map((agent) =>
      toAgentRow(agent.id, agent.name, agent.status, statsByAgent.get(agent.id) ?? emptyStats()),
    )
    // Archived agents only matter while they still have replies in the range.
    .filter((row) => row.status !== "ARCHIVED" || row.replies > 0)
    .sort((first, second) => second.replies - first.replies);

  const knownAgentIds = new Set(agents.map((agent) => agent.id));
  const orphanStats = emptyStats();

  for (const [agentId, stats] of statsByAgent) {
    if (agentId === null || !knownAgentIds.has(agentId)) {
      orphanStats.replies += stats.replies;
      orphanStats.fallbacks += stats.fallbacks;
      orphanStats.tokens += stats.tokens;
      orphanStats.durationMs += stats.durationMs;
    }
  }

  if (orphanStats.replies > 0) {
    agentRows.push(toAgentRow(null, "Deleted or unassigned agent", null, orphanStats));
  }

  const knowledgeCount = (statuses: string[]) =>
    knowledgeGroups
      .filter((group) => statuses.includes(group.status))
      .reduce((sum, group) => sum + group._count._all, 0);

  return (
    <OverviewWorkspace
      rangeDays={rangeDays}
      firstName={session.user.fullName.split(" ")[0] || session.user.fullName}
      kpis={{
        aiReplies: totals.replies,
        avgResponseMs: totals.replies > 0 ? totals.durationMs / totals.replies : null,
        fallbackRate: totals.replies > 0 ? totals.fallbacks / totals.replies : null,
        tokens: totals.tokens,
        openTickets,
        activeChats,
        waitingChats,
        teamOnline,
        teamSize,
      }}
      agents={agentRows}
      knowledge={{
        synced: knowledgeCount(["SYNCED"]),
        queued: knowledgeCount(["PENDING", "PROCESSING"]),
        failed: knowledgeCount(["FAILED"]),
        warnings: knowledgeWarnings,
      }}
      alerts={alerts.notifications}
      unreadAlerts={alerts.unreadCount}
    />
  );
}
