import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { loadAnalyticsReports, parseAnalyticsRange, workspaceTimeZone } from "@/src/lib/analytics";
import { anonymizeCustomer, interactionStatus } from "@/src/lib/analytics-math";
import { getCurrentSession } from "@/src/lib/auth";
import { csvCell } from "@/src/lib/lead-list";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";

const MAX_EXPORT_ROWS = 10_000;
const EXPORT_TYPES = new Set(["interactions", "conversations", "faq"]);

function toCsv(header: string[], rows: unknown[][]) {
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function formatLocal(date: Date | null, timeZone: string) {
  if (!date) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

/**
 * Report exports (Module 4 FE-2/FE-4): `type=interactions` (every AI answer),
 * `conversations` (session summary) or `faq`, for the same range/channel filters as
 * the dashboard. Customers are anonymised (SRS: "user identifier (anonymized)").
 * Manager role or higher.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
  }

  const params = new URL(request.url).searchParams;
  const type = params.get("type") ?? "interactions";

  if (!EXPORT_TYPES.has(type)) {
    return NextResponse.json({ error: "type must be interactions, conversations or faq." }, { status: 400 });
  }

  const { workspaceId } = session.user;
  const timeZone = await workspaceTimeZone(workspaceId);
  const range = parseAnalyticsRange(params, timeZone);
  const channelFilter = range.channel ? { channel: range.channel } : {};
  let csv: string;

  if (type === "interactions") {
    const rows = await prisma.aiInteraction.findMany({
      where: { workspaceId, createdAt: { gte: range.from, lt: range.to }, ...channelFilter } as Prisma.AiInteractionWhereInput,
      orderBy: { createdAt: "desc" },
      take: MAX_EXPORT_ROWS,
      select: {
        createdAt: true,
        channel: true,
        question: true,
        latencyMs: true,
        tokens: true,
        model: true,
        confidence: true,
        grounded: true,
        usedFallback: true,
        messageId: true,
        sessionId: true,
        ticketId: true,
        agent: { select: { name: true } },
        session: { select: { contactId: true, customerName: true } },
      },
    });
    const feedback = await prisma.messageFeedback.findMany({
      where: { messageId: { in: rows.map((row) => row.messageId).filter((id): id is string => Boolean(id)) } },
      select: { messageId: true, rating: true },
    });
    const ratings = new Map(feedback.map((item) => [item.messageId, item.rating]));

    csv = toCsv(
      ["Time", "Channel", "Customer", "Question", "Response time (ms)", "Answered from knowledge", "Fallback", "Confidence", "Feedback", "Agent", "Model", "Tokens", "Conversation / ticket"],
      rows.map((row) => [
        formatLocal(row.createdAt, timeZone),
        row.channel,
        row.session ? anonymizeCustomer(row.session.customerName, row.session.contactId ?? row.sessionId ?? "") : "Email",
        row.question,
        row.latencyMs,
        row.grounded ? "yes" : "no",
        row.usedFallback ? "yes" : "no",
        row.confidence.toFixed(2),
        row.messageId && ratings.has(row.messageId) ? (ratings.get(row.messageId)! > 0 ? "helpful" : "not helpful") : "",
        row.agent?.name ?? "",
        row.model ?? "",
        row.tokens,
        row.sessionId ?? row.ticketId ?? "",
      ]),
    );
  } else if (type === "conversations") {
    const rows = await prisma.chatSession.findMany({
      where: { workspaceId, startedAt: { gte: range.from, lt: range.to }, ...channelFilter } as Prisma.ChatSessionWhereInput,
      orderBy: { startedAt: "desc" },
      take: MAX_EXPORT_ROWS,
      select: {
        id: true,
        channel: true,
        status: true,
        resolution: true,
        closedReason: true,
        startedAt: true,
        lastActivityAt: true,
        endedAt: true,
        messageCount: true,
        aiMessageCount: true,
        customerName: true,
        contactId: true,
        previousSessionId: true,
        _count: { select: { leads: true } },
      },
    });

    csv = toCsv(
      ["Started", "Channel", "Customer", "Status", "Close reason", "Duration (s)", "Messages", "AI replies", "Returning", "Lead", "Conversation ID"],
      rows.map((row) => [
        formatLocal(row.startedAt, timeZone),
        row.channel,
        anonymizeCustomer(row.customerName, row.contactId ?? row.id),
        interactionStatus(row),
        row.closedReason ?? "",
        Math.round((row.lastActivityAt.getTime() - row.startedAt.getTime()) / 1000),
        row.messageCount,
        row.aiMessageCount,
        row.previousSessionId ? "yes" : "no",
        row._count.leads > 0 ? "yes" : "no",
        row.id,
      ]),
    );
  } else {
    const reports = await loadAnalyticsReports(workspaceId, range);

    csv = toCsv(
      ["Question", "Times asked", "Share", "Answered from knowledge", "Fallback rate", "Channels", "Other wordings", "Last asked"],
      reports.faq.map((cluster) => [
        cluster.label,
        cluster.count,
        cluster.share === null ? "" : `${Math.round(cluster.share * 100)}%`,
        cluster.answeredRate === null ? "" : `${Math.round(cluster.answeredRate * 100)}%`,
        cluster.fallbackRate === null ? "" : `${Math.round(cluster.fallbackRate * 100)}%`,
        Object.entries(cluster.channels).map(([channel, count]) => `${channel} ${count}`).join("; "),
        cluster.examples.slice(1).join(" | "),
        formatLocal(new Date(cluster.lastAskedAt), timeZone),
      ]),
    );
  }

  const date = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="assistdesk-${type}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
