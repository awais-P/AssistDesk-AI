import type { Prisma } from "@/app/generated/prisma/client";
import { AUDIT_CATEGORIES, type AuditCategory } from "./audit";
import { prisma } from "./prisma";

/** Module 11 FE-5: filtering, paging and CSV export of the audit log. */

export const AUDIT_PAGE_SIZE = 50;
const OUTCOMES = ["SUCCESS", "DENIED", "FAILED"] as const;

export type AuditFilters = {
  category: AuditCategory | null;
  outcome: (typeof OUTCOMES)[number] | null;
  actorId: string | null;
  query: string;
  from: Date | null;
  to: Date | null;
  page: number;
};

function parseDay(value: string | null, endOfDay: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseAuditFilters(params: URLSearchParams): AuditFilters {
  const category = params.get("category");
  const outcome = params.get("outcome");
  return {
    category: category && (AUDIT_CATEGORIES as string[]).includes(category) ? (category as AuditCategory) : null,
    outcome: outcome && (OUTCOMES as readonly string[]).includes(outcome) ? (outcome as AuditFilters["outcome"]) : null,
    actorId: params.get("actor")?.slice(0, 64) || null,
    query: (params.get("q") ?? "").trim().slice(0, 120),
    from: parseDay(params.get("from"), false),
    to: parseDay(params.get("to"), true),
    page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
  };
}

export function auditWhere(workspaceId: string, filters: AuditFilters): Prisma.AuditLogWhereInput {
  return {
    workspaceId,
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.from || filters.to ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {}),
    ...(filters.query
      ? {
          OR: [
            { summary: { contains: filters.query, mode: "insensitive" } },
            { action: { contains: filters.query, mode: "insensitive" } },
            { actorName: { contains: filters.query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

const select = {
  id: true,
  createdAt: true,
  actorType: true,
  actorId: true,
  actorName: true,
  action: true,
  category: true,
  outcome: true,
  targetType: true,
  targetId: true,
  summary: true,
  metadata: true,
  ipHash: true,
  userAgent: true,
} satisfies Prisma.AuditLogSelect;

export async function listAuditLogs(workspaceId: string, filters: AuditFilters) {
  const where = auditWhere(workspaceId, filters);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [total, rows, actors, denied7d, failedLogins7d] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, select, orderBy: { createdAt: "desc" }, skip: (filters.page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE }),
    prisma.auditLog.findMany({ where: { workspaceId, actorId: { not: null } }, distinct: ["actorId"], select: { actorId: true, actorName: true, actorType: true }, orderBy: { actorId: "asc" }, take: 200 }),
    prisma.auditLog.count({ where: { workspaceId, outcome: "DENIED", createdAt: { gte: since } } }),
    prisma.auditLog.count({ where: { workspaceId, action: "auth.login_failed", createdAt: { gte: since } } }),
  ]);

  return {
    entries: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    total,
    page: filters.page,
    pageSize: AUDIT_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    actors: actors.map((actor) => ({ id: actor.actorId as string, name: actor.actorName, type: actor.actorType })),
    summary: { denied7d, failedLogins7d },
  };
}

export type AuditListResult = Awaited<ReturnType<typeof listAuditLogs>>;

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function exportAuditCsv(workspaceId: string, filters: AuditFilters) {
  const rows = await prisma.auditLog.findMany({ where: auditWhere(workspaceId, filters), select, orderBy: { createdAt: "desc" }, take: 10_000 });
  const header = ["Time (UTC)", "Actor", "Actor type", "Action", "Category", "Outcome", "Target type", "Target id", "Summary", "Details", "IP (hashed)", "User agent"];
  const lines = rows.map((row) =>
    [row.createdAt.toISOString(), row.actorName, row.actorType, row.action, row.category, row.outcome, row.targetType, row.targetId, row.summary, row.metadata, row.ipHash, row.userAgent]
      .map(csvCell)
      .join(","),
  );
  return { csv: [header.join(","), ...lines].join("\r\n"), count: rows.length };
}
