import type { ChannelType, Prisma } from "@/app/generated/prisma/client";
import {
  ANALYTICS_CHANNELS,
  type AnalyticsChannel,
  type QuestionSample,
  activityHeatmap,
  average,
  clusterQuestions,
  dateKeysBetween,
  delta,
  interactionStatus,
  latencyBuckets,
  percentile,
  ratio,
  safeTimeZone,
  zonedParts,
} from "./analytics-math";
import { embedTexts, getConfiguredEmbeddingModel, isSemanticModel } from "./embeddings";
import { prisma } from "./prisma";

/**
 * Module 4 Monitoring & Analytics.
 *
 * - FE-1 interaction patterns: volume, channels, activity heatmap, engagement, handoffs.
 * - FE-2 transcripts: every conversation is stored (ChatMessage); exports and QA lists link to them.
 * - FE-3 dashboard (SRS FR-11.1–11.7): response time, automation rate, leads, live
 *   sessions, 24-hour latency chart, recent interactions.
 * - FE-4 reports: frequently asked questions (clustered), customer behaviour, leads, tickets.
 * - FE-5 improvement areas: knowledge gaps, unhelpful answers, escalation reasons.
 *
 * The store is AiInteraction (one row per AI reply, written by conversation-runtime and
 * ticket-workflow) plus the sessions, messages, events, leads and feedback of M5/M8.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 180;
const MAX_ROWS = 20_000;

export type AnalyticsPreset = "24h" | "7d" | "30d" | "90d" | "custom";

export type AnalyticsRange = {
  preset: AnalyticsPreset;
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  channel: AnalyticsChannel | null;
  timeZone: string;
};

const PRESET_DAYS: Record<Exclude<AnalyticsPreset, "custom">, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

function parseDay(value: string | null, endOfDay: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `range=24h|7d|30d|90d` or `from=YYYY-MM-DD&to=YYYY-MM-DD` (max 180 days), `channel=`. */
export function parseAnalyticsRange(params: URLSearchParams, timeZone: string, now = new Date()): AnalyticsRange {
  const zone = safeTimeZone(timeZone);
  const channel = (ANALYTICS_CHANNELS as readonly string[]).includes(params.get("channel") ?? "")
    ? (params.get("channel") as AnalyticsChannel)
    : null;
  const customFrom = parseDay(params.get("from"), false);
  const customTo = parseDay(params.get("to"), true);
  let preset: AnalyticsPreset = "7d";
  let from: Date;
  let to: Date;

  if (customFrom && customTo && customFrom <= customTo) {
    preset = "custom";
    to = customTo > now ? now : customTo;
    from = new Date(Math.max(customFrom.getTime(), to.getTime() - MAX_RANGE_DAYS * DAY_MS));
  } else {
    const requested = params.get("range") as Exclude<AnalyticsPreset, "custom"> | null;
    preset = requested && requested in PRESET_DAYS ? requested : "7d";
    to = now;
    from = new Date(now.getTime() - PRESET_DAYS[preset as Exclude<AnalyticsPreset, "custom">] * DAY_MS);
  }

  const length = to.getTime() - from.getTime();

  return {
    preset,
    from,
    to,
    previousFrom: new Date(from.getTime() - length),
    previousTo: from,
    channel,
    timeZone: zone,
  };
}

export async function workspaceTimeZone(workspaceId: string) {
  const settings = await prisma.workspaceSetting.findUnique({ where: { workspaceId }, select: { timezone: true } });
  return safeTimeZone(settings?.timezone ?? "UTC");
}

function channelWhere(channel: AnalyticsChannel | null) {
  return channel ? { channel: channel as ChannelType } : {};
}

type PeriodStats = {
  replies: number;
  avgResponseMs: number | null;
  groundedRate: number | null;
  conversations: number;
  automationRate: number | null;
  leads: number;
  helpfulRate: number | null;
};

async function periodStats(workspaceId: string, from: Date, to: Date, channel: AnalyticsChannel | null): Promise<PeriodStats> {
  const interactionWhere: Prisma.AiInteractionWhereInput = { workspaceId, createdAt: { gte: from, lt: to }, ...channelWhere(channel) };
  const [latency, grounded, conversations, resolutions, leads, feedback] = await Promise.all([
    prisma.aiInteraction.aggregate({ where: interactionWhere, _avg: { latencyMs: true }, _count: { _all: true } }),
    prisma.aiInteraction.count({ where: { ...interactionWhere, grounded: true } }),
    prisma.chatSession.count({ where: { workspaceId, startedAt: { gte: from, lt: to }, ...channelWhere(channel) } }),
    prisma.chatSession.groupBy({
      by: ["resolution"],
      where: { workspaceId, endedAt: { gte: from, lt: to }, resolution: { not: null }, ...channelWhere(channel) },
      _count: { _all: true },
    }),
    prisma.lead.count({ where: { workspaceId, createdAt: { gte: from, lt: to }, ...channelWhere(channel) } }),
    prisma.messageFeedback.groupBy({
      by: ["rating"],
      where: { workspaceId, createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    }),
  ]);
  const finished = resolutions.reduce((total, group) => total + group._count._all, 0);
  const aiResolved = resolutions.find((group) => group.resolution === "AI_RESOLVED")?._count._all ?? 0;
  const up = feedback.find((group) => group.rating > 0)?._count._all ?? 0;
  const down = feedback.find((group) => group.rating < 0)?._count._all ?? 0;

  return {
    replies: latency._count._all,
    avgResponseMs: latency._avg.latencyMs === null ? null : Math.round(latency._avg.latencyMs),
    groundedRate: ratio(grounded, latency._count._all),
    conversations,
    automationRate: ratio(aiResolved, finished),
    leads,
    helpfulRate: ratio(up, up + down),
  };
}

/** Analytics dashboard (FE-1, FE-3, SRS FR-11.1–11.7). */
export async function loadAnalyticsDashboard(workspaceId: string, range: AnalyticsRange) {
  const { from, to, channel, timeZone } = range;
  const now = new Date();
  const interactionWhere: Prisma.AiInteractionWhereInput = { workspaceId, createdAt: { gte: from, lt: to }, ...channelWhere(channel) };
  const sessionWhere: Prisma.ChatSessionWhereInput = { workspaceId, startedAt: { gte: from, lt: to }, ...channelWhere(channel) };

  const [
    interactions,
    last24h,
    sessions,
    finishedSessions,
    leads,
    liveSessions,
    liveByChannel,
    feedback,
    takeovers,
    emailTickets,
    previous,
    agents,
  ] = await Promise.all([
    prisma.aiInteraction.findMany({
      where: interactionWhere,
      select: { latencyMs: true, createdAt: true, grounded: true, usedFallback: true, agentId: true, channel: true, messageId: true, tokens: true },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    }),
    prisma.aiInteraction.findMany({
      where: { workspaceId, createdAt: { gte: new Date(now.getTime() - DAY_MS) }, ...channelWhere(channel) },
      select: { latencyMs: true, createdAt: true },
      take: MAX_ROWS,
    }),
    prisma.chatSession.findMany({
      where: sessionWhere,
      select: { id: true, channel: true, startedAt: true, messageCount: true, contactId: true, previousSessionId: true },
      orderBy: { startedAt: "desc" },
      take: MAX_ROWS,
    }),
    prisma.chatSession.findMany({
      where: { workspaceId, endedAt: { gte: from, lt: to }, resolution: { not: null }, ...channelWhere(channel) },
      select: { channel: true, resolution: true, startedAt: true, lastActivityAt: true },
      take: MAX_ROWS,
    }),
    prisma.lead.findMany({
      where: { workspaceId, createdAt: { gte: from, lt: to }, ...channelWhere(channel) },
      select: { score: true, source: true, channel: true },
      take: MAX_ROWS,
    }),
    prisma.chatSession.count({ where: { workspaceId, status: { in: ["ACTIVE", "ESCALATED"] }, ...channelWhere(channel) } }),
    prisma.chatSession.groupBy({
      by: ["channel", "status"],
      where: { workspaceId, status: { in: ["ACTIVE", "ESCALATED"] } },
      _count: { _all: true },
    }),
    prisma.messageFeedback.findMany({
      where: { workspaceId, createdAt: { gte: from, lt: to } },
      select: { rating: true, messageId: true },
      take: MAX_ROWS,
    }),
    prisma.sessionEvent.findMany({
      where: { workspaceId, type: "HUMAN_TAKEOVER", createdAt: { gte: from, lt: to } },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
    !channel || channel === "EMAIL"
      ? prisma.ticket.findMany({
          where: { workspaceId, source: "EMAIL", createdAt: { gte: from, lt: to } },
          select: { createdAt: true },
          take: MAX_ROWS,
        })
      : Promise.resolve([]),
    periodStats(workspaceId, range.previousFrom, range.previousTo, channel),
    prisma.aIAgent.findMany({ where: { workspaceId }, select: { id: true, name: true, status: true } }),
  ]);

  const sessionIds = sessions.map((session) => session.id);
  const [customerCounts, firstMessages] = await Promise.all([
    sessionIds.length
      ? prisma.chatMessage.groupBy({
          by: ["sessionId"],
          where: { sessionId: { in: sessionIds.slice(0, 5000) }, sender: "USER" },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    // First response time: first customer message → first AI/team reply (latest 500 conversations).
    sessionIds.length
      ? prisma.chatMessage.findMany({
          where: { sessionId: { in: sessionIds.slice(0, 500) }, sender: { in: ["USER", "AI", "AGENT"] } },
          select: { sessionId: true, sender: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const firstCustomer = new Map<string, number>();
  const firstReply = new Map<string, number>();
  for (const message of firstMessages) {
    if (message.sender === "USER") {
      if (!firstCustomer.has(message.sessionId)) firstCustomer.set(message.sessionId, message.createdAt.getTime());
    } else if (firstCustomer.has(message.sessionId) && !firstReply.has(message.sessionId)) {
      firstReply.set(message.sessionId, message.createdAt.getTime());
    }
  }
  const firstResponseTimes = [...firstReply.entries()].map(([id, at]) => at - (firstCustomer.get(id) ?? at));

  const latencies = interactions.map((item) => item.latencyMs);
  const engaged = customerCounts.filter((group) => group._count._all >= 2).length;
  const resolutionCounts = { AI_RESOLVED: 0, HUMAN_HANDLED: 0, UNANSWERED: 0 };
  for (const session of finishedSessions) {
    if (session.resolution && session.resolution in resolutionCounts) {
      resolutionCounts[session.resolution as keyof typeof resolutionCounts] += 1;
    }
  }
  const finishedCount = finishedSessions.length;
  const up = feedback.filter((item) => item.rating > 0).length;
  const down = feedback.filter((item) => item.rating < 0).length;

  const kpis = {
    // FR-11.1
    avgResponseMs: latencies.length ? Math.round(average(latencies) as number) : null,
    p95ResponseMs: percentile(latencies, 95),
    aiReplies: interactions.length,
    // FR-11.2
    automationRate: ratio(resolutionCounts.AI_RESOLVED, finishedCount),
    finishedConversations: finishedCount,
    aiResolved: resolutionCounts.AI_RESOLVED,
    // FR-11.3
    leadsCaptured: leads.length,
    hotLeads: leads.filter((lead) => lead.score >= 70).length,
    // FR-11.4 (right now, not the period)
    liveSessions,
    liveWithTeam: liveByChannel
      .filter((group) => group.status === "ESCALATED" && (!channel || group.channel === channel))
      .reduce((total, group) => total + group._count._all, 0),
    // FE-3 "conversation volume" and "engagement rate"
    conversations: sessions.length + emailTickets.length,
    chatConversations: sessions.length,
    emailTickets: emailTickets.length,
    engagementRate: ratio(engaged, sessions.length),
    escalationRate: ratio(takeovers.length, sessions.length),
    groundedRate: ratio(interactions.filter((item) => item.grounded).length, interactions.length),
    fallbackRate: ratio(interactions.filter((item) => item.usedFallback).length, interactions.length),
    helpfulRate: ratio(up, up + down),
    feedbackCount: up + down,
    avgFirstResponseMs: firstResponseTimes.length ? Math.round(average(firstResponseTimes) as number) : null,
    avgDurationSeconds: finishedSessions.length
      ? Math.round(
          (average(finishedSessions.map((session) => session.lastActivityAt.getTime() - session.startedAt.getTime())) as number) / 1000,
        )
      : null,
    returningCustomers: sessions.filter((session) => session.previousSessionId).length,
  };

  const changes = {
    avgResponseMs: delta(kpis.avgResponseMs, previous.avgResponseMs),
    automationRate:
      kpis.automationRate !== null && previous.automationRate !== null ? kpis.automationRate - previous.automationRate : null,
    leadsCaptured: delta(kpis.leadsCaptured, previous.leads),
    conversations: delta(kpis.chatConversations, previous.conversations),
    aiReplies: delta(kpis.aiReplies, previous.replies),
    helpfulRate: kpis.helpfulRate !== null && previous.helpfulRate !== null ? kpis.helpfulRate - previous.helpfulRate : null,
  };

  // Daily volume per channel (+ AI replies), in the workspace time zone.
  const days = dateKeysBetween(from, to, timeZone).slice(-MAX_RANGE_DAYS);
  const volume = new Map(
    days.map((day) => [day, { date: day, WEB_WIDGET: 0, WHATSAPP: 0, SLACK: 0, EMAIL: 0, total: 0, aiReplies: 0 }]),
  );
  for (const session of sessions) {
    const row = volume.get(zonedParts(session.startedAt, timeZone).dateKey);
    if (row && session.channel in row) {
      row[session.channel as AnalyticsChannel] += 1;
      row.total += 1;
    }
  }
  for (const ticket of emailTickets) {
    const row = volume.get(zonedParts(ticket.createdAt, timeZone).dateKey);
    if (row) {
      row.EMAIL += 1;
      row.total += 1;
    }
  }
  for (const interaction of interactions) {
    const row = volume.get(zonedParts(interaction.createdAt, timeZone).dateKey);
    if (row) row.aiReplies += 1;
  }

  // Per channel.
  const channels = ANALYTICS_CHANNELS.filter((item) => !channel || item === channel).map((item) => {
    const finished = finishedSessions.filter((session) => session.channel === item);
    const replies = interactions.filter((interaction) => interaction.channel === item);
    return {
      channel: item,
      conversations: item === "EMAIL" ? emailTickets.length : sessions.filter((session) => session.channel === item).length,
      aiReplies: replies.length,
      avgResponseMs: replies.length ? Math.round(average(replies.map((reply) => reply.latencyMs)) as number) : null,
      automationRate: item === "EMAIL" ? null : ratio(finished.filter((session) => session.resolution === "AI_RESOLVED").length, finished.length),
      live: liveByChannel.filter((group) => group.channel === item).reduce((total, group) => total + group._count._all, 0),
    };
  });

  // Activity heatmap of customer messages (FE-1 interaction patterns).
  const customerMessages = sessionIds.length
    ? await prisma.chatMessage.findMany({
        where: { sessionId: { in: sessionIds.slice(0, 5000) }, sender: "USER", createdAt: { gte: from, lt: to } },
        select: { createdAt: true },
        take: MAX_ROWS,
      })
    : [];

  // Recent interactions (FR-11.6, FR-11.7): newest first.
  const recent = await prisma.chatSession.findMany({
    where: { workspaceId, ...channelWhere(channel) },
    orderBy: { lastActivityAt: "desc" },
    take: 15,
    select: {
      id: true,
      channel: true,
      status: true,
      resolution: true,
      startedAt: true,
      lastActivityAt: true,
      messageCount: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      contact: { select: { name: true, email: true, phone: true } },
    },
  });

  // Per-agent quality.
  const feedbackByMessage = new Map(feedback.map((item) => [item.messageId, item.rating]));
  const agentRows = agents
    .map((agent) => {
      const replies = interactions.filter((interaction) => interaction.agentId === agent.id);
      const rated = replies.map((reply) => (reply.messageId ? feedbackByMessage.get(reply.messageId) : undefined)).filter((rating): rating is number => rating !== undefined);
      return {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        replies: replies.length,
        avgResponseMs: replies.length ? Math.round(average(replies.map((reply) => reply.latencyMs)) as number) : null,
        p95ResponseMs: percentile(replies.map((reply) => reply.latencyMs), 95),
        groundedRate: ratio(replies.filter((reply) => reply.grounded).length, replies.length),
        fallbackRate: ratio(replies.filter((reply) => reply.usedFallback).length, replies.length),
        helpfulRate: ratio(rated.filter((rating) => rating > 0).length, rated.length),
        tokens: replies.reduce((total, reply) => total + reply.tokens, 0),
      };
    })
    .filter((row) => row.replies > 0 || row.status === "ACTIVE")
    .sort((a, b) => b.replies - a.replies);

  return {
    range: {
      preset: range.preset,
      from: from.toISOString(),
      to: to.toISOString(),
      channel,
      timeZone,
    },
    kpis,
    changes,
    previous,
    latency24h: latencyBuckets(last24h.map((item) => ({ at: item.createdAt, latencyMs: item.latencyMs })), now, timeZone),
    volume: [...volume.values()],
    channels,
    resolutions: { ...resolutionCounts, open: liveSessions },
    heatmap: activityHeatmap(customerMessages.map((message) => message.createdAt), timeZone),
    recent: recent.map((session) => ({
      sessionId: session.id,
      customer:
        session.contact?.name ||
        session.customerName ||
        session.contact?.email ||
        session.customerEmail ||
        session.contact?.phone ||
        session.customerPhone ||
        "Visitor",
      channel: session.channel,
      status: interactionStatus(session),
      durationSeconds: Math.max(0, Math.round((session.lastActivityAt.getTime() - session.startedAt.getTime()) / 1000)),
      messageCount: session.messageCount,
      lastActivityAt: session.lastActivityAt.toISOString(),
    })),
    agents: agentRows,
    generatedAt: now.toISOString(),
  };
}

export type AnalyticsDashboard = Awaited<ReturnType<typeof loadAnalyticsDashboard>>;

// ---------- FE-4 reports ----------

declare global {
  var assistdeskFaqCache: Map<string, { at: number; vectors: Map<string, number[]> }> | undefined;
}

const faqCache = global.assistdeskFaqCache ?? new Map<string, { at: number; vectors: Map<string, number[]> }>();
global.assistdeskFaqCache = faqCache;
const FAQ_CACHE_MS = 10 * 60 * 1000;
const MAX_FAQ_SAMPLES = 1500;
const MAX_EMBEDDED_QUESTIONS = 300;

/**
 * Semantic vectors for questions when a real embedding model is configured, so
 * "how much is shipping" and "delivery charges?" land in one group. Cached for 10
 * minutes; any provider error falls back to word-overlap grouping.
 */
async function questionVectors(cacheKey: string, samples: QuestionSample[]) {
  const model = getConfiguredEmbeddingModel();

  if (!isSemanticModel(model) || samples.length === 0) {
    return undefined;
  }

  const cached = faqCache.get(cacheKey);

  if (cached && Date.now() - cached.at < FAQ_CACHE_MS) {
    return cached.vectors;
  }

  try {
    const subset = samples.slice(0, MAX_EMBEDDED_QUESTIONS);
    const { vectors } = await embedTexts(subset.map((sample) => sample.text.slice(0, 500)), model);
    const map = new Map(subset.map((sample, index) => [sample.id, vectors[index]]));
    faqCache.set(cacheKey, { at: Date.now(), vectors: map });
    return map;
  } catch (error) {
    console.error("[analytics] Question embeddings failed, grouping by words:", error);
    return undefined;
  }
}

function toSample(row: {
  id: string;
  question: string;
  createdAt: Date;
  channel: string;
  grounded: boolean;
  usedFallback: boolean;
}): QuestionSample {
  return {
    id: row.id,
    text: row.question,
    at: row.createdAt,
    channel: row.channel,
    grounded: row.grounded,
    usedFallback: row.usedFallback,
  };
}

/** Reports: FAQ clusters and customer behaviour (FE-4). */
export async function loadAnalyticsReports(workspaceId: string, range: AnalyticsRange) {
  const { from, to, channel, timeZone } = range;
  const interactionWhere: Prisma.AiInteractionWhereInput = { workspaceId, createdAt: { gte: from, lt: to }, ...channelWhere(channel) };

  const [questions, sessions, newContacts, activeContacts, leads, tickets] = await Promise.all([
    prisma.aiInteraction.findMany({
      where: interactionWhere,
      select: { id: true, question: true, createdAt: true, channel: true, grounded: true, usedFallback: true },
      orderBy: { createdAt: "desc" },
      take: MAX_FAQ_SAMPLES,
    }),
    prisma.chatSession.findMany({
      where: { workspaceId, startedAt: { gte: from, lt: to }, ...channelWhere(channel) },
      select: { id: true, channel: true, messageCount: true, startedAt: true, lastActivityAt: true, contactId: true, status: true },
      take: MAX_ROWS,
    }),
    prisma.contact.count({ where: { workspaceId, firstSeenAt: { gte: from, lt: to } } }),
    prisma.contact.count({ where: { workspaceId, lastSeenAt: { gte: from, lt: to } } }),
    prisma.lead.findMany({
      where: { workspaceId, createdAt: { gte: from, lt: to }, ...channelWhere(channel) },
      select: { status: true, source: true, channel: true, sessionId: true, score: true },
      take: MAX_ROWS,
    }),
    prisma.ticket.findMany({
      where: { workspaceId, createdAt: { gte: from, lt: to } },
      select: { status: true, source: true, priority: true },
      take: MAX_ROWS,
    }),
  ]);

  const samples = questions.map(toSample);
  const vectors = await questionVectors(`${workspaceId}:${from.toISOString().slice(0, 13)}:${to.toISOString().slice(0, 13)}:${channel ?? "all"}`, samples);
  const faq = clusterQuestions(samples, { vectors, limit: 20 }).map(({ ids, ...cluster }) => ({
    ...cluster,
    share: ratio(cluster.count, samples.length),
    interactionIds: ids.slice(0, 50),
  }));

  const customerMessageDates = sessions.length
    ? await prisma.chatMessage.findMany({
        where: { sessionId: { in: sessions.slice(0, 5000).map((session) => session.id) }, sender: "USER", createdAt: { gte: from, lt: to } },
        select: { createdAt: true },
        take: MAX_ROWS,
      })
    : [];
  const heatmap = activityHeatmap(customerMessageDates.map((message) => message.createdAt), timeZone);
  const hourTotals = Array.from({ length: 24 }, (_, hour) => heatmap.reduce((total, row) => total + row[hour], 0));
  const weekdayTotals = heatmap.map((row) => row.reduce((total, value) => total + value, 0));
  const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  const count = <T,>(items: T[], key: (item: T) => string) =>
    items.reduce<Record<string, number>>((acc, item) => {
      const value = key(item);
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {});
  const sessionsWithLead = new Set(leads.map((lead) => lead.sessionId).filter(Boolean));
  const returning = Math.max(0, activeContacts - newContacts);

  return {
    range: { preset: range.preset, from: from.toISOString(), to: to.toISOString(), channel, timeZone },
    faq,
    faqMethod: vectors ? "semantic" : "keywords",
    questionsAnalysed: samples.length,
    behavior: {
      newCustomers: newContacts,
      returningCustomers: returning,
      conversations: sessions.length,
      avgMessagesPerConversation: sessions.length ? Math.round((average(sessions.map((session) => session.messageCount)) as number) * 10) / 10 : null,
      avgDurationSeconds: sessions.length
        ? Math.round((average(sessions.map((session) => session.lastActivityAt.getTime() - session.startedAt.getTime())) as number) / 1000)
        : null,
      channelMix: count(sessions, (session) => session.channel),
      peakHours: hourTotals
        .map((total, hour) => ({ hour, total }))
        .filter((item) => item.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 3),
      busiestDay: weekdayTotals.some((total) => total > 0)
        ? weekdayNames[weekdayTotals.indexOf(Math.max(...weekdayTotals))]
        : null,
      hourTotals,
      heatmap,
    },
    leads: {
      total: leads.length,
      conversionRate: ratio(sessions.filter((session) => sessionsWithLead.has(session.id)).length, sessions.length),
      byStatus: count(leads, (lead) => lead.status),
      bySource: count(leads, (lead) => lead.source),
      byChannel: count(leads, (lead) => lead.channel),
      hot: leads.filter((lead) => lead.score >= 70).length,
    },
    tickets: {
      total: tickets.length,
      byStatus: count(tickets, (ticket) => ticket.status),
      bySource: count(tickets, (ticket) => ticket.source),
      byPriority: count(tickets, (ticket) => ticket.priority),
    },
  };
}

export type AnalyticsReports = Awaited<ReturnType<typeof loadAnalyticsReports>>;

// ---------- FE-5 improvement areas ----------

/** What to teach the assistant next: unanswered questions, unhelpful replies, escalations. */
export async function loadImprovementAreas(workspaceId: string, range: AnalyticsRange) {
  const { from, to, channel } = range;
  const base: Prisma.AiInteractionWhereInput = { workspaceId, createdAt: { gte: from, lt: to }, ...channelWhere(channel) };

  const [gaps, gapTotal, reviewedTotal, negative, takeovers, unanswered, agents] = await Promise.all([
    prisma.aiInteraction.findMany({
      where: { ...base, reviewedAt: null, OR: [{ grounded: false }, { usedFallback: true }] },
      select: { id: true, question: true, createdAt: true, channel: true, grounded: true, usedFallback: true },
      orderBy: { createdAt: "desc" },
      take: MAX_FAQ_SAMPLES,
    }),
    prisma.aiInteraction.count({ where: { ...base, OR: [{ grounded: false }, { usedFallback: true }] } }),
    prisma.aiInteraction.count({ where: { ...base, reviewedAt: { not: null } } }),
    prisma.messageFeedback.findMany({
      where: { workspaceId, rating: { lt: 0 }, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        comment: true,
        createdAt: true,
        sessionId: true,
        message: { select: { id: true, content: true, session: { select: { channel: true } } } },
      },
    }),
    prisma.sessionEvent.findMany({
      where: { workspaceId, type: "HUMAN_TAKEOVER", createdAt: { gte: from, lt: to }, sessionId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { sessionId: true, createdAt: true, detail: true },
    }),
    prisma.chatSession.findMany({
      where: { workspaceId, resolution: "UNANSWERED", endedAt: { gte: from, lt: to }, ...channelWhere(channel) },
      orderBy: { endedAt: "desc" },
      take: 20,
      select: { id: true, channel: true, endedAt: true, closedReason: true },
    }),
    prisma.aIAgent.findMany({ where: { workspaceId }, select: { id: true, name: true, confidenceThreshold: true } }),
  ]);

  const negativeInteractions = negative.length
    ? await prisma.aiInteraction.findMany({
        where: { messageId: { in: negative.map((item) => item.message.id) } },
        select: { messageId: true, question: true, grounded: true, agentId: true },
      })
    : [];
  const questionByMessage = new Map(negativeInteractions.map((item) => [item.messageId, item]));

  // The customer's last message before each human takeover: why the AI was not enough.
  const escalations = [];
  for (const takeover of takeovers.slice(0, 50)) {
    const last = await prisma.chatMessage.findFirst({
      where: { sessionId: takeover.sessionId as string, sender: "USER", createdAt: { lte: takeover.createdAt } },
      orderBy: { createdAt: "desc" },
      select: { content: true, session: { select: { channel: true } } },
    });

    if (last) {
      escalations.push({
        sessionId: takeover.sessionId as string,
        question: last.content.slice(0, 300),
        channel: last.session.channel,
        at: takeover.createdAt.toISOString(),
        detail: takeover.detail,
      });
    }
  }

  const escalationClusters = clusterQuestions(
    escalations.map((item, index) => ({
      id: `${item.sessionId}:${index}`,
      text: item.question,
      at: new Date(item.at),
      channel: item.channel,
      grounded: false,
      usedFallback: false,
    })),
    { limit: 10 },
  ).map(({ ids, ...cluster }) => ({ ...cluster, sessionIds: [...new Set(ids.map((id) => id.split(":")[0]))] }));

  return {
    range: { preset: range.preset, from: from.toISOString(), to: to.toISOString(), channel, timeZone: range.timeZone },
    knowledgeGaps: clusterQuestions(gaps.map(toSample), { limit: 25 }).map(({ ids, ...cluster }) => ({
      ...cluster,
      // All questions of the group, so "mark as handled" covers every wording (max 1000).
      interactionIds: ids.slice(0, 1000),
    })),
    gapStats: { open: gaps.length, total: gapTotal, reviewed: reviewedTotal },
    negativeFeedback: negative.map((item) => {
      const interaction = questionByMessage.get(item.message.id);
      return {
        id: item.id,
        sessionId: item.sessionId,
        channel: item.message.session.channel,
        question: interaction?.question ?? null,
        answer: item.message.content.slice(0, 600),
        grounded: interaction?.grounded ?? null,
        agent: agents.find((agent) => agent.id === interaction?.agentId)?.name ?? null,
        comment: item.comment,
        createdAt: item.createdAt.toISOString(),
      };
    }),
    escalations: escalationClusters,
    escalationCount: takeovers.length,
    unanswered: unanswered.map((session) => ({
      sessionId: session.id,
      channel: session.channel,
      endedAt: session.endedAt?.toISOString() ?? null,
      closedReason: session.closedReason,
    })),
    agents: agents.map((agent) => ({ id: agent.id, name: agent.name, confidenceThreshold: agent.confidenceThreshold })),
  };
}

export type ImprovementAreas = Awaited<ReturnType<typeof loadImprovementAreas>>;
