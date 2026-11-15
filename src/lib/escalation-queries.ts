import type { Prisma } from "@/app/generated/prisma/client";
import { DEFAULT_ESCALATION_SETTINGS, TRIGGER_LABELS, type EscalationSettings, type EscalationTrigger } from "./escalation-triggers";
import { prisma } from "./prisma";

/**
 * Module 9 queue, reporting and settings helpers for the Escalations page and API.
 * The pure parts (stats, CSV, settings validation) are unit-tested.
 */

export type EscalationView = "queue" | "mine" | "in_progress" | "resolved" | "all";
export const ESCALATION_VIEWS: EscalationView[] = ["queue", "mine", "in_progress", "resolved", "all"];

const include = {
  session: { select: { id: true, status: true, customerName: true, customerEmail: true, customerPhone: true, channel: true, lastActivityAt: true } },
  ticket: { select: { id: true, ticketNumber: true, subject: true, status: true, requesterName: true, requesterEmail: true, inbox: { select: { ticketPrefix: true } } } },
  contact: { select: { id: true, name: true, email: true, phone: true, aiPaused: true } },
  assignee: { select: { id: true, fullName: true } },
  resolvedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.EscalationInclude;

type Row = Prisma.EscalationGetPayload<{ include: typeof include }>;

export function viewFilter(view: EscalationView, userId: string): Prisma.EscalationWhereInput {
  switch (view) {
    case "queue":
      return { status: "PENDING" };
    case "mine":
      return { status: { in: ["PENDING", "ACCEPTED"] }, assigneeId: userId };
    case "in_progress":
      return { status: "ACCEPTED" };
    case "resolved":
      return { status: "RESOLVED" };
    default:
      return {};
  }
}

export function customerLabel(row: Pick<Row, "session" | "ticket" | "contact">) {
  return (
    row.contact?.name ??
    row.session?.customerName ??
    row.ticket?.requesterName ??
    row.contact?.email ??
    row.session?.customerEmail ??
    row.ticket?.requesterEmail ??
    row.session?.customerPhone ??
    (row.session?.channel === "WEB_WIDGET" ? "Website visitor" : "Unknown customer")
  );
}

export function serializeEscalation(row: Row, now = new Date()) {
  const open = row.status !== "RESOLVED";
  return {
    id: row.id,
    status: row.status,
    trigger: row.trigger,
    triggerLabel: TRIGGER_LABELS[row.trigger as EscalationTrigger] ?? row.trigger,
    reason: row.reason,
    priority: row.priority,
    channel: row.channel,
    sentimentScore: row.sentimentScore,
    summary: row.summary,
    summaryGeneratedAt: row.summaryGeneratedAt?.toISOString() ?? null,
    customer: customerLabel(row),
    contact: row.contact,
    session: row.session ? { id: row.session.id, status: row.session.status } : null,
    ticket: row.ticket
      ? { id: row.ticket.id, number: `${row.ticket.inbox?.ticketPrefix ?? "T"}-${row.ticket.ticketNumber}`, subject: row.ticket.subject, status: row.ticket.status }
      : null,
    link: row.sessionId ? `/dashboard/chats?session=${row.sessionId}` : row.ticketId ? `/dashboard/tickets/${row.ticketId}` : null,
    assignee: row.assignee,
    resolvedBy: row.resolvedBy,
    resolution: row.resolution,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    slaDueAt: row.slaDueAt?.toISOString() ?? null,
    slaBreached: Boolean(row.slaBreachedAt) || (open && row.status === "PENDING" && Boolean(row.slaDueAt && row.slaDueAt <= now)),
  };
}

export type SerializedEscalation = ReturnType<typeof serializeEscalation>;

export async function listEscalations({
  workspaceId,
  userId,
  view = "queue",
  take = 100,
  ids,
}: {
  workspaceId: string;
  userId: string;
  view?: EscalationView;
  take?: number;
  ids?: string[];
}) {
  const rows = await prisma.escalation.findMany({
    where: { workspaceId, ...(ids ? { id: { in: ids } } : viewFilter(view, userId)) },
    include,
    // The queue shows the most urgent and longest-waiting first.
    orderBy: view === "queue" ? [{ createdAt: "asc" }] : [{ createdAt: "desc" }],
    take,
  });
  const now = new Date();
  const items = rows.map((row) => serializeEscalation(row, now));
  const rank = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
  return view === "queue" ? items.sort((a, b) => rank[a.priority] - rank[b.priority]) : items;
}

type StatRow = {
  status: string;
  trigger: string;
  createdAt: Date;
  acceptedAt: Date | null;
  resolvedAt: Date | null;
  slaDueAt: Date | null;
  slaBreachedAt: Date | null;
};

/** Queue tiles and the last 30 days' response figures. */
export function computeEscalationStats(rows: StatRow[], now = new Date()) {
  const open = rows.filter((row) => row.status !== "RESOLVED");
  const pending = open.filter((row) => row.status === "PENDING");
  // MANUAL escalations start accepted, so they say nothing about response time.
  const automatic = rows.filter((row) => row.trigger !== "MANUAL" && row.acceptedAt);
  const waits = automatic.map((row) => (row.acceptedAt!.getTime() - row.createdAt.getTime()) / 60_000);
  const withSla = automatic.filter((row) => row.slaDueAt);
  const metSla = withSla.filter((row) => row.acceptedAt! <= row.slaDueAt!);
  const byTrigger: Record<string, number> = {};

  for (const row of rows) {
    byTrigger[row.trigger] = (byTrigger[row.trigger] ?? 0) + 1;
  }

  return {
    pending: pending.length,
    inProgress: open.length - pending.length,
    overdue: pending.filter((row) => row.slaBreachedAt || (row.slaDueAt && row.slaDueAt <= now)).length,
    resolved: rows.filter((row) => row.status === "RESOLVED").length,
    total: rows.length,
    averageAcceptMinutes: waits.length ? Math.round((waits.reduce((sum, value) => sum + value, 0) / waits.length) * 10) / 10 : null,
    slaMetPercent: withSla.length ? Math.round((metSla.length / withSla.length) * 100) : null,
    byTrigger,
  };
}

export async function escalationStats(workspaceId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.escalation.findMany({
    where: { workspaceId, OR: [{ createdAt: { gte: since } }, { status: { in: ["PENDING", "ACCEPTED"] } }] },
    select: { status: true, trigger: true, createdAt: true, acceptedAt: true, resolvedAt: true, slaDueAt: true, slaBreachedAt: true },
    take: 5000,
  });
  return computeEscalationStats(rows);
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  // Leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function escalationsToCsv(items: SerializedEscalation[]) {
  const header = ["Created", "Customer", "Channel", "Trigger", "Reason", "Priority", "Status", "Assignee", "Accepted", "Resolved", "Resolution", "SLA breached", "Sentiment", "Summary"];
  const lines = items.map((item) =>
    [
      item.createdAt,
      item.customer,
      item.channel,
      item.triggerLabel,
      item.reason,
      item.priority,
      item.status,
      item.assignee?.fullName ?? "",
      item.acceptedAt ?? "",
      item.resolvedAt ?? "",
      item.resolution ?? "",
      item.slaBreached ? "yes" : "no",
      item.sentimentScore ?? "",
      item.summary ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}

// --------------------------------------------------------------- settings

export const MAX_ESCALATION_KEYWORDS = 30;

/** Validates a settings update; returns the WorkspaceSetting fields or an error. */
export function parseEscalationSettings(body: Record<string, unknown>):
  | { data: Partial<Record<string, unknown>>; error?: undefined }
  | { error: string; data?: undefined } {
  const data: Record<string, unknown> = {};
  const flags: Array<[keyof typeof body, string]> = [
    ["enabled", "escalationEnabled"],
    ["sentimentEnabled", "escalationSentimentEnabled"],
    ["onHumanRequest", "escalationOnHumanRequest"],
    ["sensitiveTopics", "escalationSensitiveTopics"],
  ];

  for (const [key, column] of flags) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "boolean") return { error: `${String(key)} must be true or false.` };
      data[column] = body[key];
    }
  }

  if (body.sentimentThreshold !== undefined) {
    const value = Number(body.sentimentThreshold);
    if (!Number.isFinite(value) || value < -0.95 || value > -0.1) {
      return { error: "The sentiment threshold must be between -0.95 (only very upset) and -0.1 (any unhappiness)." };
    }
    data.escalationSentimentThreshold = Math.round(value * 100) / 100;
  }

  if (body.slaMinutes !== undefined) {
    const value = Number(body.slaMinutes);
    if (!Number.isInteger(value) || value < 1 || value > 1440) {
      return { error: "The response time must be between 1 and 1440 minutes." };
    }
    data.escalationSlaMinutes = value;
  }

  if (body.keywords !== undefined) {
    if (!Array.isArray(body.keywords)) return { error: "Trigger phrases must be a list." };
    const keywords = [
      ...new Set(
        body.keywords
          .map((value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().toLowerCase() : ""))
          .filter(Boolean),
      ),
    ];
    if (keywords.length > MAX_ESCALATION_KEYWORDS) return { error: `Up to ${MAX_ESCALATION_KEYWORDS} trigger phrases.` };
    if (keywords.some((keyword) => keyword.length < 3 || keyword.length > 60)) {
      return { error: "Each trigger phrase must be 3 to 60 characters." };
    }
    data.escalationKeywords = keywords;
  }

  return { data };
}

export function publicEscalationSettings(settings: EscalationSettings = DEFAULT_ESCALATION_SETTINGS) {
  return { ...settings };
}
