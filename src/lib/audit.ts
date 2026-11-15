import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { getRequestIp, hashClientIp } from "./rate-limit";

/**
 * Module 11 FE-5: the security and activity log. Records who did what, when, from
 * where (a keyed hash of the IP, never the address) and whether it was allowed.
 * Append-only: there is no API to change or delete entries, and a database trigger
 * refuses UPDATE. Writing never throws, so logging can't break the action itself.
 */

export type AuditCategory = "auth" | "users" | "settings" | "integrations" | "api" | "data" | "access" | "ai";
export const AUDIT_CATEGORIES: AuditCategory[] = ["auth", "users", "settings", "integrations", "api", "data", "access", "ai"];

export type AuditActor = { type: "USER" | "API_KEY" | "SYSTEM"; id?: string | null; name: string };

type SessionUserLike = { id: string; fullName?: string | null; workspaceId: string };

export function userActor(user: SessionUserLike): AuditActor {
  return { type: "USER", id: user.id, name: user.fullName || "A team member" };
}

export const SYSTEM_ACTOR: AuditActor = { type: "SYSTEM", id: null, name: "AssistDesk" };

export type AuditEntry = {
  workspaceId: string;
  actor: AuditActor;
  action: string;
  category: AuditCategory;
  summary: string;
  outcome?: "SUCCESS" | "DENIED" | "FAILED";
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  request?: Request | null;
};

const SECRET_KEYS = /pass(word)?|secret|token|api[-_]?key|authorization|cookie/i;

/** Removes anything that looks like a secret before it reaches the log. */
export function redactMetadata(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (depth > 4) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactMetadata(item, depth + 1) ?? null) as Prisma.InputJsonValue;
  if (typeof value === "object") {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.test(key) ? "[redacted]" : (redactMetadata(item, depth + 1) ?? null);
    }
    return out;
  }
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export async function recordAudit(entry: AuditEntry) {
  try {
    const request = entry.request ?? null;
    await prisma.auditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorType: entry.actor.type,
        actorId: entry.actor.id ?? null,
        actorName: entry.actor.name.slice(0, 120),
        action: entry.action.slice(0, 64),
        category: entry.category,
        outcome: entry.outcome ?? "SUCCESS",
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        summary: entry.summary.slice(0, 500),
        metadata: redactMetadata(entry.metadata),
        ipHash: request ? hashClientIp(getRequestIp(request)) : null,
        userAgent: request?.headers.get("user-agent")?.slice(0, 200) ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] Failed to record:", error);
  }
}

const pending = new Set<Promise<unknown>>();

/** For writes that can't be awaited where they happen (refused-access checks). */
export function trackAudit(promise: Promise<unknown>) {
  pending.add(promise);
  void promise.finally(() => pending.delete(promise));
}

/** Waits for background audit writes (tests and graceful shutdown). */
export async function settleAudits() {
  await Promise.allSettled([...pending]);
}

/** Shortcut for the common case: a signed-in team member did something. */
export function auditUser(
  user: SessionUserLike,
  entry: Omit<AuditEntry, "workspaceId" | "actor">,
) {
  return recordAudit({ ...entry, workspaceId: user.workspaceId, actor: userActor(user) });
}

/** Which fields changed between two objects (names only, values for non-secrets). */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (after[key] === undefined) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = SECRET_KEYS.test(key) ? { from: "[redacted]", to: "[redacted]" } : { from: before[key] ?? null, to: after[key] };
    }
  }
  return changes;
}
