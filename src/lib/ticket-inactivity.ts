import { aiReplyAllowed } from "./billing";
import { findOpenEscalation } from "./escalation";
import { generateCompletion, toRuntimeAgent } from "./llm-runtime";
import { sendTicketReplyEmail } from "./mailer";
import { prisma } from "./prisma";
import { extractTaggedOutput } from "./session-memory";
import { parseInactivityHours } from "./ticket-rules";
import { createAutomationLog, findTicketAgent } from "./ticket-workflow";

/**
 * The two SCHEDULED ticket automations of an AI agent (BUG-06, UI-44):
 * - **AI Follow-up**: when the customer hasn't answered our last reply for the set time
 *   ("After 24h of inactivity"), one short follow-up email asks whether they still need help.
 * - **Close Ticket**: when the customer still hasn't answered after the set time
 *   ("After 48h of inactivity"), the ticket is closed.
 *
 * Both count from the last real reply to the customer, so the follow-up itself does not
 * postpone the close. Tickets waiting for the team (the customer wrote last) or with an
 * open escalation are never touched. Runs from the background jobs and the cron route.
 */

export const FOLLOW_UP_AUTHOR = "AI follow-up";
const AUTO_REPLY_AUTHOR = "Auto-reply";
const DEFAULT_FOLLOW_UP_HOURS = 24;
const DEFAULT_CLOSE_HOURS = 48;
const HOUR = 60 * 60 * 1000;

type AgentRules = { followUpHours: number | null; closeHours: number | null };

export async function runTicketInactivityAutomations({
  now = new Date(),
  limit = 200,
  workspaceId,
}: { now?: Date; limit?: number; workspaceId?: string } = {}) {
  const automations = await prisma.agentAutomation.findMany({
    where: { isEnabled: true, key: { in: ["ai-follow-up", "close-ticket"] }, ...(workspaceId ? { agent: { workspaceId } } : {}) },
    select: { agentId: true, key: true, summary: true, agent: { select: { workspaceId: true } } },
  });

  const rules = new Map<string, AgentRules>();
  for (const automation of automations) {
    const entry = rules.get(automation.agentId) ?? { followUpHours: null, closeHours: null };
    if (automation.key === "ai-follow-up") {
      entry.followUpHours = parseInactivityHours(automation.summary, DEFAULT_FOLLOW_UP_HOURS);
    } else {
      entry.closeHours = parseInactivityHours(automation.summary, DEFAULT_CLOSE_HOURS);
    }
    rules.set(automation.agentId, entry);
  }

  const result = { checked: 0, followUps: 0, closed: 0 };

  if (rules.size === 0) {
    return result;
  }

  const shortest = Math.min(
    ...[...rules.values()].flatMap((entry) => [entry.followUpHours, entry.closeHours]).filter((hours): hours is number => hours !== null),
  );
  const tickets = await prisma.ticket.findMany({
    where: {
      workspaceId: { in: [...new Set(automations.map((automation) => automation.agent.workspaceId))] },
      status: { in: ["OPEN", "IN_PROGRESS"] },
      updatedAt: { lte: new Date(now.getTime() - shortest * HOUR) },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, workspaceId: true, inboxId: true, ticketNumber: true, subject: true, requesterName: true, requesterEmail: true },
  });

  // Sequential on purpose: few tickets per run, and each may call a model.
  for (const ticket of tickets) {
    result.checked += 1;
    const agent = await findTicketAgent(ticket);
    const agentRules = agent ? rules.get(agent.id) : undefined;

    if (!agent || !agentRules) continue;
    if (await findOpenEscalation(ticket.workspaceId, { ticketId: ticket.id })) continue;

    const recent = await prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id, sender: { not: "SYSTEM" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { sender: true, authorName: true, content: true, createdAt: true },
    });
    const lastReal = recent.find((message) => message.authorName !== FOLLOW_UP_AUTHOR && message.authorName !== AUTO_REPLY_AUTHOR);

    // Nothing answered yet, or the customer wrote last: the team owes the next move.
    if (!lastReal || lastReal.sender === "USER") continue;

    const idleHours = (now.getTime() - lastReal.createdAt.getTime()) / HOUR;

    if (agentRules.closeHours !== null && idleHours >= agentRules.closeHours) {
      const closed = await prisma.ticket.updateMany({
        where: { id: ticket.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
        data: { status: "CLOSED" },
      });

      if (closed.count > 0) {
        result.closed += 1;
        await createAutomationLog({
          workspaceId: ticket.workspaceId,
          ticketId: ticket.id,
          agentId: agent.id,
          action: "CLOSE_TICKET",
          status: "SUCCESS",
          summary: `Closed after ${Math.floor(idleHours)}h without a reply from the customer (rule: ${agentRules.closeHours}h).`,
        });
      }
      continue;
    }

    const alreadyFollowedUp = recent.some(
      (message) => message.authorName === FOLLOW_UP_AUTHOR && message.createdAt > lastReal.createdAt,
    );

    if (agentRules.followUpHours === null || idleHours < agentRules.followUpHours || alreadyFollowedUp || !ticket.requesterEmail) {
      continue;
    }

    const content = await writeFollowUp(ticket, agent, lastReal.content);
    const message = await prisma.ticketMessage.create({
      data: { workspaceId: ticket.workspaceId, ticketId: ticket.id, sender: "AI", authorName: FOLLOW_UP_AUTHOR, content },
      select: { id: true },
    });
    const delivery = await sendTicketReplyEmail({ ticketId: ticket.id, ticketMessageId: message.id, content });
    result.followUps += 1;

    await createAutomationLog({
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      agentId: agent.id,
      action: "AI_FOLLOW_UP",
      status: delivery.status === "SENT" ? "SUCCESS" : "FAILED",
      model: agent.model,
      summary:
        delivery.status === "SENT"
          ? `Follow-up sent after ${Math.floor(idleHours)}h without a reply.`
          : `Follow-up written but not delivered: ${delivery.error ?? delivery.status}`.slice(0, 500),
    });
  }

  return result;
}

function templateFollowUp(ticket: { ticketNumber: number; subject: string; requesterName: string | null }) {
  const name = ticket.requesterName?.trim().split(/\s+/)[0];
  return [
    `Hi ${name || "there"},`,
    "",
    `Just checking in on your request #${ticket.ticketNumber} ("${ticket.subject}"). Did our last reply solve it?`,
    "If you still need help, simply reply to this email and we'll pick it up from here.",
  ].join("\n");
}

/** A short AI-written follow-up in the agent's voice; the fixed text when no model is available. */
async function writeFollowUp(
  ticket: { workspaceId: string; ticketNumber: number; subject: string; requesterName: string | null },
  agent: NonNullable<Awaited<ReturnType<typeof findTicketAgent>>>,
  lastReply: string,
) {
  const fallback = templateFollowUp(ticket);

  if (!(await aiReplyAllowed(ticket.workspaceId))) {
    return fallback;
  }

  const raw = await generateCompletion({
    agent: toRuntimeAgent(agent),
    system:
      "You write short, friendly customer-support follow-up emails. Never promise anything, never invent facts, and never repeat the earlier answer in full.",
    prompt: [
      `Customer first name: ${ticket.requesterName?.trim().split(/\s+/)[0] || "unknown"}`,
      `Ticket: #${ticket.ticketNumber} "${ticket.subject}"`,
      `<our_last_reply>\n${lastReply.slice(0, 1500)}\n</our_last_reply>`,
      "The customer has not answered our last reply. Write a follow-up of at most 60 words that asks whether the issue is solved and invites them to reply if they still need help. Reply with only the email body inside <email></email> tags.",
    ].join("\n\n"),
    maxTokens: 250,
  }).catch(() => null);

  const text = extractTaggedOutput(raw, "email")?.trim();
  return text && text.length >= 20 && text.length <= 1200 ? text : fallback;
}
