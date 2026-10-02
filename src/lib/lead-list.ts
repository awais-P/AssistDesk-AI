import type { LeadStatus, Prisma } from "@/app/generated/prisma/client";
import { LEAD_STATUSES, OPEN_LEAD_STATUSES, leadStatusLabels, leadTemperature } from "./lead-form";
import { prisma } from "./prisma";

/**
 * Lead database queries (Module 8 FE-5, SRS UI-4: pagination, filtering, sorting).
 * Shared by the Leads page, GET /api/leads and the CSV export.
 */

const SORTS = ["createdAt", "lastActivityAt", "score", "name", "status"] as const;
type LeadSort = (typeof SORTS)[number];

export type LeadFilters = {
  query: string | null;
  status: LeadStatus | "OPEN" | null;
  source: string | null;
  channel: string | null;
  chatbotId: string | null;
  owner: "me" | "none" | string | null;
  temperature: "HOT" | "WARM" | "COLD" | null;
  from: Date | null;
  to: Date | null;
  sort: LeadSort;
  order: "asc" | "desc";
  page: number;
  pageSize: number;
};

const CHANNELS = new Set(["WEB_WIDGET", "WHATSAPP", "SLACK", "EMAIL", "VOICE"]);
const SOURCES = new Set(["FORM", "AUTO", "MANUAL", "AI_TOOL"]);

function parseDate(value: string | null, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return null;
  }

  const date = new Date(endOfDay && value.length === 10 ? `${value}T23:59:59.999Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseLeadFilters(params: URLSearchParams): LeadFilters {
  const status = params.get("status");
  const sort = params.get("sort") as LeadSort | null;
  const temperature = params.get("temperature");
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(Number(params.get("pageSize")) || 25)));

  return {
    query: params.get("q")?.trim().slice(0, 120) || null,
    status:
      status === "OPEN" || (LEAD_STATUSES as readonly string[]).includes(status ?? "")
        ? (status as LeadStatus | "OPEN")
        : null,
    source: SOURCES.has(params.get("source") ?? "") ? params.get("source") : null,
    channel: CHANNELS.has(params.get("channel") ?? "") ? params.get("channel") : null,
    chatbotId: params.get("chatbotId")?.slice(0, 40) || null,
    owner: params.get("owner")?.slice(0, 40) || null,
    temperature: temperature === "HOT" || temperature === "WARM" || temperature === "COLD" ? temperature : null,
    from: parseDate(params.get("from")),
    to: parseDate(params.get("to"), true),
    sort: sort && (SORTS as readonly string[]).includes(sort) ? sort : "createdAt",
    order: params.get("order") === "asc" ? "asc" : "desc",
    page,
    pageSize,
  };
}

export function buildLeadWhere(workspaceId: string, filters: LeadFilters, currentUserId: string) {
  const where: Prisma.LeadWhereInput = { workspaceId };
  const and: Prisma.LeadWhereInput[] = [];

  if (filters.status === "OPEN") {
    where.status = { in: OPEN_LEAD_STATUSES as LeadStatus[] };
  } else if (filters.status) {
    where.status = filters.status;
  }

  if (filters.source) where.source = filters.source;
  if (filters.channel) where.channel = filters.channel as Prisma.LeadWhereInput["channel"];
  if (filters.chatbotId) where.chatbotId = filters.chatbotId;

  if (filters.owner === "me") {
    where.ownerId = currentUserId;
  } else if (filters.owner === "none") {
    where.ownerId = null;
  } else if (filters.owner) {
    where.ownerId = filters.owner;
  }

  if (filters.temperature === "HOT") where.score = { gte: 70 };
  if (filters.temperature === "WARM") where.score = { gte: 40, lt: 70 };
  if (filters.temperature === "COLD") where.score = { lt: 40 };

  if (filters.from || filters.to) {
    where.createdAt = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) };
  }

  if (filters.query) {
    const contains = { contains: filters.query, mode: "insensitive" as const };
    and.push({
      OR: [{ name: contains }, { email: contains }, { phone: contains }, { company: contains }, { intent: contains }],
    });
  }

  if (and.length) {
    where.AND = and;
  }

  return where;
}

const listSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  company: true,
  intent: true,
  source: true,
  channel: true,
  status: true,
  score: true,
  marketingConsent: true,
  fields: true,
  lastActivityAt: true,
  createdAt: true,
  chatbot: { select: { id: true, name: true } },
  owner: { select: { id: true, fullName: true } },
  sessionId: true,
  contactId: true,
} satisfies Prisma.LeadSelect;

type LeadRow = Prisma.LeadGetPayload<{ select: typeof listSelect }>;

function serializeRow(lead: LeadRow) {
  return {
    ...lead,
    fields: Array.isArray(lead.fields) ? (lead.fields as Array<{ key: string; label: string; value: string }>) : [],
    temperature: leadTemperature(lead.score),
    lastActivityAt: lead.lastActivityAt.toISOString(),
    createdAt: lead.createdAt.toISOString(),
  };
}

export type LeadListItem = ReturnType<typeof serializeRow>;

function orderBy(filters: LeadFilters): Prisma.LeadOrderByWithRelationInput[] {
  const direction = filters.order;

  switch (filters.sort) {
    case "name":
      return [{ name: { sort: direction, nulls: "last" } }, { createdAt: "desc" }];
    case "score":
      return [{ score: direction }, { createdAt: "desc" }];
    case "status":
      return [{ status: direction }, { createdAt: "desc" }];
    case "lastActivityAt":
      return [{ lastActivityAt: direction }];
    default:
      return [{ createdAt: direction }];
  }
}

export async function loadLeadList(workspaceId: string, filters: LeadFilters, currentUserId: string) {
  const where = buildLeadWhere(workspaceId, filters, currentUserId);
  const [rows, total, grouped] = await Promise.all([
    prisma.lead.findMany({
      where,
      select: listSelect,
      orderBy: orderBy(filters),
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
  ]);

  const statusCounts = Object.fromEntries(LEAD_STATUSES.map((status) => [status, 0])) as Record<LeadStatus, number>;
  for (const group of grouped) {
    statusCounts[group.status] = group._count._all;
  }

  return {
    leads: rows.map(serializeRow),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
    statusCounts,
  };
}

/** Quotes a CSV cell and defuses spreadsheet formulas (CSV injection). */
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const MAX_EXPORT_ROWS = 5000;

/** FE-4: export of the filtered lead list, one column per custom field. */
export async function exportLeadsCsv(workspaceId: string, filters: LeadFilters, currentUserId: string) {
  const rows = await prisma.lead.findMany({
    where: buildLeadWhere(workspaceId, filters, currentUserId),
    select: listSelect,
    orderBy: orderBy(filters),
    take: MAX_EXPORT_ROWS,
  });
  const leads = rows.map(serializeRow);
  const customColumns = new Map<string, string>();

  for (const lead of leads) {
    for (const field of lead.fields) {
      if (!customColumns.has(field.key)) {
        customColumns.set(field.key, field.label);
      }
    }
  }

  const header = [
    "Name",
    "Email",
    "Phone",
    "Company",
    "Status",
    "Score",
    "Temperature",
    "Interested in",
    "Source",
    "Channel",
    "Chatbot",
    "Owner",
    "Marketing consent",
    ...customColumns.values(),
    "Created",
    "Last activity",
    "Lead ID",
  ];
  const lines = leads.map((lead) => {
    const custom = new Map(lead.fields.map((field) => [field.key, field.value]));

    return [
      lead.name,
      lead.email,
      lead.phone,
      lead.company,
      leadStatusLabels[lead.status],
      lead.score,
      lead.temperature,
      lead.intent,
      lead.source,
      lead.channel,
      lead.chatbot?.name,
      lead.owner?.fullName,
      lead.marketingConsent ? "yes" : "no",
      ...[...customColumns.keys()].map((key) => custom.get(key) ?? ""),
      lead.createdAt,
      lead.lastActivityAt,
      lead.id,
    ]
      .map(csvCell)
      .join(",");
  });

  // BOM so Excel opens UTF-8 (Urdu names) correctly.
  return { csv: `﻿${[header.map(csvCell).join(","), ...lines].join("\r\n")}\r\n`, count: leads.length };
}
