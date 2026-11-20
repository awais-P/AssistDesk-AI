import type { Prisma } from "@/app/generated/prisma/client";
import { can } from "./permissions";
import { PRESENCE_WINDOW_MS } from "./presence";

/**
 * Module 9 routing. In QUEUE mode every new escalation waits in the shared queue for
 * someone to accept it. In ROUND_ROBIN mode it is assigned straight away to the next team
 * member in turn; it stays PENDING (shown under "Mine" for them, still in the queue for
 * everyone) until they accept it, so the response deadline still applies and a colleague
 * can step in.
 */
export type EscalationRouting = "QUEUE" | "ROUND_ROBIN";
export const ESCALATION_ROUTINGS: EscalationRouting[] = ["QUEUE", "ROUND_ROBIN"];

export type RoutedAssignee = { id: string; fullName: string; email: string };

/** The member after `lastId` in a stable order, wrapping round; the first one if `lastId` is gone. */
export function nextInRotation(candidateIds: string[], lastId: string | null) {
  if (candidateIds.length === 0) {
    return null;
  }

  const ordered = [...candidateIds].sort();

  if (!lastId) {
    return ordered[0];
  }

  // The first id after the last one assigned: works even when that member has since left
  // the rotation (or went offline), so nobody is skipped twice.
  return ordered.find((id) => id > lastId) ?? ordered[0];
}

/**
 * Picks the assignee for a new escalation, inside the transaction that creates it. The
 * workspace settings row is locked so two escalations opened at the same moment go to
 * different people.
 */
export async function routeNewEscalation(tx: Prisma.TransactionClient, workspaceId: string, now = new Date()): Promise<RoutedAssignee | null> {
  const rows = await tx.$queryRaw<Array<{ routing: string; userIds: string[] | null; onlineOnly: boolean; lastId: string | null }>>`
    SELECT "escalationRouting" AS routing, "escalationRoutingUserIds" AS "userIds", "escalationRoutingOnlineOnly" AS "onlineOnly", "escalationLastRoutedUserId" AS "lastId"
    FROM "WorkspaceSetting" WHERE "workspaceId" = ${workspaceId} FOR UPDATE`;
  const settings = rows[0];

  if (!settings || settings.routing !== "ROUND_ROBIN") {
    return null;
  }

  const chosen = settings.userIds ?? [];
  const members = await tx.user.findMany({
    where: {
      workspaceId,
      isActive: true,
      ...(chosen.length > 0 ? { id: { in: chosen } } : {}),
      ...(settings.onlineOnly ? { lastSeenAt: { gte: new Date(now.getTime() - PRESENCE_WINDOW_MS) } } : {}),
    },
    select: { id: true, fullName: true, email: true, role: true, customRole: { select: { permissions: true, deniedPermissions: true } } },
  });
  // Only people who may handle conversations (a custom role can take that away).
  const eligible = members.filter((member) => can(member, "tickets.handle"));
  const nextId = nextInRotation(
    eligible.map((member) => member.id),
    settings.lastId,
  );

  if (!nextId) {
    return null;
  }

  await tx.workspaceSetting.update({ where: { workspaceId }, data: { escalationLastRoutedUserId: nextId }, select: { id: true } });
  const assignee = eligible.find((member) => member.id === nextId)!;
  return { id: assignee.id, fullName: assignee.fullName, email: assignee.email };
}
