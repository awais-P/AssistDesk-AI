import type { Prisma } from "@/app/generated/prisma/client";
import {
  type EscalationPriority,
  type EscalationTrigger,
  TRIGGER_LABELS,
  evaluateEscalation,
  escalationSettingsFrom,
  slaDueAt,
} from "./escalation-triggers";
import { sendEscalationAlerts } from "./escalation-alerts";
import { routeNewEscalation } from "./escalation-routing";
import { createNotification } from "./notifications";
import { prisma } from "./prisma";
import { publishConversationEvent } from "./realtime";
import { appendSessionMessage, closeSession, recordSessionEvent } from "./session-lifecycle";

/**
 * Module 9 - Support Escalation. Every way a conversation reaches a person goes
 * through here (the AI's hand-over tool, a failed action, a trigger on the customer's
 * message, a team member taking over or replying, an upset email), so the team sees
 * one queue with the reason, a summary, an owner and a response deadline (SLA).
 *
 * Lifecycle: PENDING (waiting in the queue) -> ACCEPTED (a team member owns it) ->
 * RESOLVED (handed back to the AI, conversation closed, or resolved with the team).
 * A conversation or ticket has at most one open escalation; row locks keep two
 * triggers arriving together from opening two.
 */

export const OPEN_STATUSES = ["PENDING", "ACCEPTED"] as const;
export type EscalationOutcome = "HANDED_BACK" | "CLOSED" | "RESOLVED";
export const ESCALATION_OUTCOMES: EscalationOutcome[] = ["HANDED_BACK", "CLOSED", "RESOLVED"];

const PRIORITY_RANK: Record<EscalationPriority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 };

export class EscalationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type EscalationActor = { id: string; fullName: string };

/** What the customer sees when their conversation is handed to the team. */
export function customerNoticeFor(trigger: EscalationTrigger, priority: EscalationPriority) {
  if (priority === "URGENT") {
    return "I've asked a member of our team to help you right away. If you are in danger, please contact your local emergency services now.";
  }

  switch (trigger) {
    case "HUMAN_REQUEST":
      return "Of course - I'm connecting you with a member of our team. They'll reply here shortly.";
    case "SENTIMENT":
      return "I'm sorry about the trouble. I've asked a member of our team to take over - they'll reply here shortly.";
    case "AI_TOOL":
    case "TOOL_FAILURE":
      return "The AI assistant has asked a team member to join this conversation.";
    default:
      return "I've passed this to a member of our team, who will reply here shortly.";
  }
}

export async function loadEscalationSettings(workspaceId: string) {
  const row = await prisma.workspaceSetting.findUnique({
    where: { workspaceId },
    select: {
      escalationEnabled: true,
      escalationSentimentEnabled: true,
      escalationSentimentThreshold: true,
      escalationOnHumanRequest: true,
      escalationSensitiveTopics: true,
      escalationKeywords: true,
      escalationSlaMinutes: true,
    },
  });
  return escalationSettingsFrom(row);
}

type LockedTarget = { id: string; status: string; contactId: string | null; channel: string; name: string | null };

async function lockSession(tx: Prisma.TransactionClient, workspaceId: string, sessionId: string) {
  const rows = await tx.$queryRaw<LockedTarget[]>`
    SELECT id, status::text AS status, "contactId", channel::text AS channel, COALESCE("customerName", "customerEmail", "customerPhone") AS name
    FROM "ChatSession" WHERE id = ${sessionId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
  return rows[0] ?? null;
}

async function lockTicket(tx: Prisma.TransactionClient, workspaceId: string, ticketId: string) {
  const rows = await tx.$queryRaw<Array<LockedTarget & { priority: string }>>`
    SELECT id, status::text AS status, "contactId", 'EMAIL' AS channel, COALESCE("requesterName", "requesterEmail") AS name, priority::text AS priority
    FROM "Ticket" WHERE id = ${ticketId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
  return rows[0] ?? null;
}

async function lockEscalation(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Escalation" WHERE id = ${id} AND "workspaceId" = ${workspaceId} FOR UPDATE`;

  if (!rows[0]) {
    throw new EscalationError("Escalation not found.", 404);
  }

  return tx.escalation.findUniqueOrThrow({ where: { id }, include: { assignee: { select: { id: true, fullName: true } } } });
}

export type OpenEscalationInput = {
  workspaceId: string;
  sessionId?: string | null;
  ticketId?: string | null;
  contactId?: string | null;
  trigger: EscalationTrigger;
  reason: string;
  priority?: EscalationPriority;
  sentimentScore?: number | null;
  /** A team member taking over: the escalation is accepted by them at once. */
  actor?: EscalationActor | null;
  /** SYSTEM message for the customer; null for none, undefined for the default. */
  customerNotice?: string | null;
  /** Detail for the HUMAN_TAKEOVER timeline event. */
  eventDetail?: string;
  eventMetadata?: Record<string, Prisma.InputJsonValue | null>;
};

/**
 * Opens an escalation for a conversation or a ticket and pauses the AI there. If one is
 * already open it is reused (its priority raised if this trigger is more serious).
 */
export async function openEscalation(input: OpenEscalationInput) {
  const { workspaceId, actor = null } = input;
  const sessionId = input.sessionId ?? null;
  const ticketId = sessionId ? null : (input.ticketId ?? null);

  if (!sessionId && !ticketId) {
    throw new EscalationError("An escalation needs a conversation or a ticket.");
  }

  const settings = await loadEscalationSettings(workspaceId);
  const priority = input.priority ?? "MEDIUM";

  const result = await prisma.$transaction(async (tx) => {
    const target = sessionId ? await lockSession(tx, workspaceId, sessionId) : await lockTicket(tx, workspaceId, ticketId!);

    if (!target) {
      throw new EscalationError(sessionId ? "Conversation not found." : "Ticket not found.", 404);
    }

    if (sessionId && target.status === "CLOSED") {
      throw new EscalationError("This conversation has already ended.", 409);
    }

    const existing = await tx.escalation.findFirst({
      where: { workspaceId, status: { in: [...OPEN_STATUSES] }, ...(sessionId ? { sessionId } : { ticketId }) },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      const raise = PRIORITY_RANK[priority] > PRIORITY_RANK[existing.priority as EscalationPriority];
      const accept = actor && existing.status === "PENDING";
      const escalation =
        raise || accept
          ? await tx.escalation.update({
              where: { id: existing.id },
              data: {
                ...(raise ? { priority } : {}),
                ...(accept ? { status: "ACCEPTED", assigneeId: actor.id, acceptedAt: new Date() } : {}),
              },
            })
          : existing;
      return { escalation, created: false, accepted: Boolean(accept), wasEscalated: true, target, routed: null };
    }

    const now = new Date();
    // Round-robin routing (if switched on) picks who it goes to; it stays PENDING until they accept.
    const routed = actor ? null : await routeNewEscalation(tx, workspaceId, now);
    const escalation = await tx.escalation.create({
      data: {
        workspaceId,
        sessionId,
        ticketId,
        contactId: input.contactId ?? target.contactId,
        channel: (target.channel === "PLAYGROUND" ? "WEB_WIDGET" : target.channel) as never,
        trigger: input.trigger,
        reason: input.reason.slice(0, 500),
        sentimentScore: input.sentimentScore ?? null,
        priority,
        status: actor ? "ACCEPTED" : "PENDING",
        assigneeId: actor?.id ?? routed?.id ?? null,
        acceptedAt: actor ? now : null,
        slaDueAt: actor ? null : slaDueAt(now, settings.slaMinutes),
        createdAt: now,
      },
    });

    const wasEscalated = sessionId ? target.status === "ESCALATED" : false;

    if (sessionId && !wasEscalated) {
      await tx.chatSession.update({ where: { id: sessionId }, data: { status: "ESCALATED" }, select: { id: true } });
    }

    if (ticketId && PRIORITY_RANK[priority] > PRIORITY_RANK[(target as LockedTarget & { priority: EscalationPriority }).priority]) {
      await tx.ticket.update({ where: { id: ticketId }, data: { priority }, select: { id: true } });
    }

    return { escalation, created: true, accepted: Boolean(actor), wasEscalated, target, routed };
  });

  const { escalation, target, routed } = result;
  const label = TRIGGER_LABELS[input.trigger];
  let noticeMessage: Awaited<ReturnType<typeof appendSessionMessage>> | null = null;

  if (sessionId && result.created) {
    if (!result.wasEscalated) {
      await recordSessionEvent({
        workspaceId,
        sessionId,
        contactId: escalation.contactId,
        type: "HUMAN_TAKEOVER",
        detail: input.eventDetail ?? `${label}: ${input.reason}`.slice(0, 500),
        metadata: { escalationId: escalation.id, escalationTrigger: input.trigger, userId: actor?.id ?? null, ...input.eventMetadata },
      });
    }

    const notice = input.customerNotice === undefined ? customerNoticeFor(input.trigger, priority) : input.customerNotice;

    if (notice) {
      noticeMessage = await appendSessionMessage({ sessionId, workspaceId, sender: "SYSTEM", content: notice });
    }

    publishConversationEvent({ workspaceId, sessionId, type: "status" });
  }

  if (ticketId && result.created) {
    await prisma.ticketMessage.create({
      data: { workspaceId, ticketId, sender: "SYSTEM", content: `[[INTERNAL_NOTE]]\nEscalated to the team (${label}): ${input.reason}`.slice(0, 2000) },
    });
  }

  if (result.created && !actor) {
    await createNotification({
      workspaceId,
      type: "ESCALATION_CREATED",
      severity: priority === "URGENT" ? "ERROR" : "WARNING",
      title: `${priority === "URGENT" || priority === "HIGH" ? `${priority === "URGENT" ? "Urgent" : "High priority"} escalation` : "Escalation"}: ${target.name ?? "a customer"}${routed ? ` (assigned to ${routed.fullName})` : ""}`,
      body: `${label} - ${input.reason}`,
      link: `/dashboard/escalations?id=${escalation.id}`,
    });

    if (routed && sessionId) {
      await recordSessionEvent({
        workspaceId,
        sessionId,
        contactId: escalation.contactId,
        type: "ESCALATION_ROUTED",
        detail: `Assigned to ${routed.fullName} by round-robin routing.`,
        metadata: { escalationId: escalation.id, assigneeId: routed.id },
      });
    }

    // Email and Slack in the background: the customer's reply must not wait for them.
    void sendEscalationAlerts(workspaceId, {
      kind: "created",
      escalationId: escalation.id,
      customer: target.name ?? "A customer",
      channel: escalation.channel,
      priority,
      triggerLabel: label,
      reason: input.reason.slice(0, 300),
      assignee: routed ? { fullName: routed.fullName, email: routed.email } : null,
      slaMinutes: settings.slaMinutes,
    }).catch((error) => console.error("[escalation] alert failed:", error));
  }

  if (result.created) {
    scheduleEscalationSummary(escalation.id);
  }

  return { escalation, created: result.created, noticeMessage };
}

/** A team member takes an escalation from the queue (or takes it over from a colleague). */
export async function acceptEscalation({
  workspaceId,
  escalationId,
  actor,
  force = false,
}: {
  workspaceId: string;
  escalationId: string;
  actor: EscalationActor;
  force?: boolean;
}) {
  const { escalation, changed } = await prisma.$transaction(async (tx) => {
    const current = await lockEscalation(tx, workspaceId, escalationId);

    if (current.status === "RESOLVED") {
      throw new EscalationError("This escalation is already resolved.", 409);
    }

    if (current.assigneeId === actor.id && current.status === "ACCEPTED") {
      return { escalation: current, changed: false };
    }

    if (current.status === "ACCEPTED" && current.assigneeId && !force) {
      throw new EscalationError(`${current.assignee?.fullName ?? "Another team member"} is already handling this.`, 409);
    }

    const updated = await tx.escalation.update({
      where: { id: escalationId },
      data: { status: "ACCEPTED", assigneeId: actor.id, acceptedAt: current.acceptedAt ?? new Date() },
      include: { assignee: { select: { id: true, fullName: true } } },
    });

    if (updated.ticketId) {
      await tx.ticket.updateMany({ where: { id: updated.ticketId, assigneeId: null }, data: { assigneeId: actor.id } });
    }

    return { escalation: updated, changed: true };
  });

  if (changed && escalation.sessionId) {
    await appendSessionMessage({
      sessionId: escalation.sessionId,
      workspaceId,
      sender: "SYSTEM",
      content: `${actor.fullName} joined the conversation.`,
    });
    await recordSessionEvent({
      workspaceId,
      sessionId: escalation.sessionId,
      contactId: escalation.contactId,
      type: "ESCALATION_ACCEPTED",
      detail: `${actor.fullName} accepted the escalation.`,
      metadata: { escalationId, userId: actor.id },
    });
    publishConversationEvent({ workspaceId, sessionId: escalation.sessionId, type: "status" });
  }

  return escalation;
}

/** A manager gives an escalation to a team member. */
export async function assignEscalation({
  workspaceId,
  escalationId,
  assigneeId,
  actor,
}: {
  workspaceId: string;
  escalationId: string;
  assigneeId: string;
  actor: EscalationActor;
}) {
  const assignee = await prisma.user.findFirst({
    where: { id: assigneeId, workspaceId, isActive: true },
    select: { id: true, fullName: true },
  });

  if (!assignee) {
    throw new EscalationError("Choose an active member of this workspace.");
  }

  const escalation = await prisma.$transaction(async (tx) => {
    const current = await lockEscalation(tx, workspaceId, escalationId);

    if (current.status === "RESOLVED") {
      throw new EscalationError("This escalation is already resolved.", 409);
    }

    return tx.escalation.update({
      where: { id: escalationId },
      data: { status: "ACCEPTED", assigneeId: assignee.id, acceptedAt: current.acceptedAt ?? new Date() },
      include: { assignee: { select: { id: true, fullName: true } } },
    });
  });

  if (escalation.sessionId) {
    await recordSessionEvent({
      workspaceId,
      sessionId: escalation.sessionId,
      contactId: escalation.contactId,
      type: "ESCALATION_ASSIGNED",
      detail: `${actor.fullName} assigned the escalation to ${assignee.fullName}.`,
      metadata: { escalationId, userId: actor.id, assigneeId: assignee.id },
    });
    publishConversationEvent({ workspaceId, sessionId: escalation.sessionId, type: "status" });
  }

  if (assignee.id !== actor.id) {
    await createNotification({
      workspaceId,
      type: "ESCALATION_ASSIGNED",
      title: `${actor.fullName} assigned an escalation to ${assignee.fullName}`,
      body: escalation.reason,
      link: `/dashboard/escalations?id=${escalation.id}`,
    });
  }

  return escalation;
}

/**
 * Ends an escalation. HANDED_BACK lets the AI answer again, CLOSED ends the
 * conversation, RESOLVED leaves the conversation with the team. keepWithTeam marks the
 * customer so their future conversations go straight to a person (Contact.aiPaused).
 */
export async function resolveEscalation({
  workspaceId,
  escalationId,
  actor,
  outcome,
  note = null,
  keepWithTeam = false,
}: {
  workspaceId: string;
  escalationId: string;
  actor: EscalationActor | null;
  outcome: EscalationOutcome;
  note?: string | null;
  keepWithTeam?: boolean;
}) {
  if (!ESCALATION_OUTCOMES.includes(outcome)) {
    throw new EscalationError("Choose how to resolve: hand back to the AI, close the conversation, or keep it with the team.");
  }

  if (outcome === "HANDED_BACK" && keepWithTeam) {
    throw new EscalationError("A customer kept with the team cannot be handed back to the AI.");
  }

  const escalation = await prisma.$transaction(async (tx) => {
    const current = await lockEscalation(tx, workspaceId, escalationId);

    if (current.status === "RESOLVED") {
      throw new EscalationError("This escalation is already resolved.", 409);
    }

    if (outcome !== "RESOLVED" && !current.sessionId) {
      throw new EscalationError("Ticket escalations are resolved with the team.");
    }

    const updated = await tx.escalation.update({
      where: { id: escalationId },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedById: actor?.id ?? null,
        resolution: outcome,
        resolutionNote: note?.slice(0, 1000) || null,
        assigneeId: current.assigneeId ?? actor?.id ?? null,
        acceptedAt: current.acceptedAt ?? new Date(),
      },
    });

    if (updated.contactId && (keepWithTeam || outcome === "HANDED_BACK")) {
      await tx.contact.update({ where: { id: updated.contactId }, data: { aiPaused: keepWithTeam }, select: { id: true } });
    }

    return updated;
  });

  const by = actor ? ` by ${actor.fullName}` : "";

  if (escalation.sessionId) {
    await recordSessionEvent({
      workspaceId,
      sessionId: escalation.sessionId,
      contactId: escalation.contactId,
      type: "ESCALATION_RESOLVED",
      detail: `Escalation resolved${by}: ${outcome === "HANDED_BACK" ? "handed back to the AI" : outcome === "CLOSED" ? "conversation closed" : "kept with the team"}${note ? ` - ${note}` : ""}`.slice(0, 500),
      metadata: { escalationId, outcome, keepWithTeam, userId: actor?.id ?? null },
    });

    if (outcome === "HANDED_BACK") {
      const resumed = await prisma.chatSession.updateMany({
        where: { id: escalation.sessionId, status: "ESCALATED" },
        data: { status: "ACTIVE" },
      });

      if (resumed.count > 0) {
        await recordSessionEvent({
          workspaceId,
          sessionId: escalation.sessionId,
          contactId: escalation.contactId,
          type: "AI_RESUMED",
          detail: `${actor?.fullName ?? "The team"} handed the conversation back to the AI.`,
          metadata: { escalationId, userId: actor?.id ?? null },
        });
        await appendSessionMessage({
          sessionId: escalation.sessionId,
          workspaceId,
          sender: "SYSTEM",
          content: "The AI assistant is back in the conversation.",
        });
      }
    } else if (outcome === "CLOSED") {
      await closeSession(escalation.sessionId, "CLOSED_BY_AGENT", { actorName: actor?.fullName ?? null });
    }

    publishConversationEvent({ workspaceId, sessionId: escalation.sessionId, type: "status" });
  }

  if (escalation.ticketId) {
    await prisma.ticketMessage.create({
      data: {
        workspaceId,
        ticketId: escalation.ticketId,
        sender: "SYSTEM",
        content: `[[INTERNAL_NOTE]]\nEscalation resolved${by}.${note ? ` ${note}` : ""}`.slice(0, 2000),
      },
    });
  }

  return escalation;
}

/** The open escalation of a conversation, if any. */
export function findOpenEscalation(workspaceId: string, where: { sessionId?: string; ticketId?: string }) {
  return prisma.escalation.findFirst({
    where: { workspaceId, status: { in: [...OPEN_STATUSES] }, ...where },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Runs the escalation triggers on the customer's newest message before the AI answers
 * (Module 9 FE-1, FE-3). Stores the message's sentiment; when a trigger fires, the
 * conversation goes to the team and the customer is told so instead of getting an AI
 * reply. Never throws: a failure here must not stop the conversation.
 */
export async function checkInboundEscalation({ workspaceId, sessionId, text }: { workspaceId: string; sessionId: string; text: string }) {
  try {
    const [session, settings, userMessages] = await Promise.all([
      prisma.chatSession.findFirst({
        where: { id: sessionId, workspaceId },
        select: { status: true, contactId: true, contact: { select: { aiPaused: true } } },
      }),
      loadEscalationSettings(workspaceId),
      prisma.chatMessage.findMany({
        where: { sessionId, sender: "USER" },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, sentiment: true },
      }),
    ]);

    if (!session) {
      return { escalated: false as const, sentiment: null };
    }

    const [latest, ...previous] = userMessages;
    const recentSentiments = previous
      .map((message) => message.sentiment)
      .filter((value): value is number => typeof value === "number")
      .reverse();
    const { sentiment, decision } = evaluateEscalation({
      message: text,
      settings,
      recentSentiments,
      contactAiPaused: session.contact?.aiPaused ?? false,
    });

    if (latest) {
      await prisma.chatMessage.update({ where: { id: latest.id }, data: { sentiment }, select: { id: true } });
    }

    if (!decision || session.status !== "ACTIVE") {
      return { escalated: false as const, sentiment };
    }

    const opened = await openEscalation({
      workspaceId,
      sessionId,
      contactId: session.contactId,
      trigger: decision.trigger,
      reason: decision.reason,
      priority: decision.priority,
      sentimentScore: decision.sentimentScore,
      eventMetadata: { trigger: "auto" },
    });

    return { escalated: true as const, sentiment, decision, escalation: opened.escalation, noticeMessage: opened.noticeMessage };
  } catch (error) {
    console.error("[escalation] Trigger check failed:", error);
    return { escalated: false as const, sentiment: null };
  }
}

/**
 * Email tickets (FE-1 on the email channel): an upset or sensitive customer email is
 * escalated, the ticket's priority raised and the AI auto-reply skipped.
 */
export async function checkTicketEscalation({ workspaceId, ticketId, text }: { workspaceId: string; ticketId: string; text: string }) {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, workspaceId },
      select: { contactId: true, contact: { select: { aiPaused: true } } },
    });

    if (!ticket) {
      return { escalated: false as const, sentiment: null };
    }

    const settings = await loadEscalationSettings(workspaceId);
    // On email, asking for a person is normal ("please have someone call me"); only the
    // serious triggers apply, so the AI still answers ordinary questions.
    const { sentiment, decision } = evaluateEscalation({
      message: text,
      settings: { ...settings, onHumanRequest: false },
      contactAiPaused: ticket.contact?.aiPaused ?? false,
    });

    if (!decision) {
      return { escalated: false as const, sentiment };
    }

    const opened = await openEscalation({
      workspaceId,
      ticketId,
      contactId: ticket.contactId,
      trigger: decision.trigger,
      reason: decision.reason,
      priority: decision.priority === "MEDIUM" ? "HIGH" : decision.priority,
      sentimentScore: decision.sentimentScore,
    });

    return { escalated: true as const, sentiment, decision, escalation: opened.escalation };
  } catch (error) {
    console.error("[escalation] Ticket trigger check failed:", error);
    return { escalated: false as const, sentiment: null };
  }
}

// --------------------------------------------------------------- hand-over summary

const summaryTimers = new Set<string>();

/** Writes the hand-over summary in the background (Phase 3 fills this in). */
export function scheduleEscalationSummary(escalationId: string) {
  if (summaryTimers.has(escalationId) || process.env.ASSISTDESK_ESCALATION_SUMMARY === "off") {
    return;
  }

  summaryTimers.add(escalationId);
  setTimeout(() => {
    import("./escalation-summary")
      .then(({ generateEscalationSummary }) => generateEscalationSummary(escalationId))
      .catch((error) => console.error("[escalation] Summary failed:", error))
      .finally(() => summaryTimers.delete(escalationId));
  }, 0);
}

// ------------------------------------------------------------------------ SLA

/**
 * Marks escalations nobody accepted before their deadline (SLA) and alerts the team
 * once per escalation. Runs every minute in the server and from /api/cron/sessions.
 */
export async function checkEscalationSla(now = new Date()) {
  const overdue = await prisma.escalation.findMany({
    where: { status: "PENDING", slaBreachedAt: null, slaDueAt: { lte: now } },
    orderBy: { slaDueAt: "asc" },
    take: 100,
    select: {
      id: true,
      workspaceId: true,
      sessionId: true,
      contactId: true,
      reason: true,
      createdAt: true,
      priority: true,
      channel: true,
      trigger: true,
      assignee: { select: { fullName: true, email: true } },
      session: { select: { customerName: true, customerEmail: true } },
      ticket: { select: { requesterName: true, requesterEmail: true, ticketNumber: true } },
    },
  });
  let breached = 0;

  for (const item of overdue) {
    // Only the first checker to flag it raises the alert.
    const flagged = await prisma.escalation.updateMany({
      where: { id: item.id, status: "PENDING", slaBreachedAt: null },
      data: { slaBreachedAt: now },
    });

    if (flagged.count === 0) {
      continue;
    }

    breached += 1;
    const who =
      item.session?.customerName ?? item.session?.customerEmail ?? item.ticket?.requesterName ?? item.ticket?.requesterEmail ?? "A customer";
    const minutes = Math.max(1, Math.round((now.getTime() - item.createdAt.getTime()) / 60_000));

    await createNotification({
      workspaceId: item.workspaceId,
      type: "ESCALATION_SLA_BREACHED",
      severity: "ERROR",
      title: `${who} has waited ${minutes} min for a person`,
      body: `No one accepted this escalation in time. ${item.reason}`,
      link: `/dashboard/escalations?id=${item.id}`,
    });

    if (item.sessionId) {
      await recordSessionEvent({
        workspaceId: item.workspaceId,
        sessionId: item.sessionId,
        contactId: item.contactId,
        type: "ESCALATION_SLA_BREACHED",
        detail: `Not accepted within the response time (${minutes} min waiting).`,
        metadata: { escalationId: item.id },
      });
    }

    await sendEscalationAlerts(item.workspaceId, {
      kind: "sla_breached",
      escalationId: item.id,
      customer: who,
      channel: item.channel,
      priority: item.priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
      triggerLabel: TRIGGER_LABELS[item.trigger as EscalationTrigger] ?? item.trigger,
      reason: item.reason.slice(0, 300),
      assignee: item.assignee,
      waitedMinutes: minutes,
    }).catch((error) => console.error("[escalation] overdue alert failed:", error));
  }

  return { breached };
}

declare global {
  var assistdeskEscalationSla: ReturnType<typeof setInterval> | undefined;
}

export function startEscalationSlaChecks() {
  if (globalThis.assistdeskEscalationSla || process.env.ASSISTDESK_ESCALATION_SLA === "false") {
    return;
  }

  let running = false;
  globalThis.assistdeskEscalationSla = setInterval(() => {
    if (running) return;
    running = true;
    checkEscalationSla()
      .catch((error) => console.error("[escalation] SLA check failed:", error))
      .finally(() => {
        running = false;
      });
  }, 60_000);
}
