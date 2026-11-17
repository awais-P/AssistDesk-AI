import { TRIGGER_LABELS, type EscalationTrigger } from "./escalation-triggers";
import { type AgentRuntimeConfig, generateCompletion, toRuntimeAgent } from "./llm-runtime";
import { prisma } from "./prisma";
import { publishConversationEvent } from "./realtime";
import { buildContactContext, extractTaggedOutput, formatTranscript } from "./session-memory";

/**
 * Module 9 FE-2 / FE-5: the hand-over summary. When a conversation reaches the team,
 * the AI writes what the customer needs, what was already tried, how they feel and
 * what to do next, using the transcript and what we know about the customer from
 * other channels. Without a reachable model a summary is assembled from the messages,
 * so the team never starts from nothing.
 */

const SUMMARY_SYSTEM =
  "You brief a customer-support team member who is taking over a conversation from an AI assistant. Be factual and specific: names, order numbers, dates, amounts. Never invent details. Write in English even if the customer wrote in another language.";

type Line = { sender: string; content: string };

const clip = (value: string, length: number) => {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};

export function moodLabel(sentiment: number | null | undefined) {
  if (typeof sentiment !== "number") return "unknown";
  if (sentiment <= -0.75) return "very upset";
  if (sentiment <= -0.4) return "frustrated";
  if (sentiment < -0.1) return "a little unhappy";
  if (sentiment >= 0.4) return "positive";
  return "calm";
}

/** Summary built from the messages alone (no AI model needed). */
export function fallbackEscalationSummary({
  messages,
  trigger,
  reason,
  sentiment,
}: {
  messages: Line[];
  trigger: string;
  reason: string;
  sentiment: number | null;
}) {
  const customer = messages.filter((message) => message.sender === "USER" && message.content.trim());
  const answers = messages.filter((message) => (message.sender === "AI" || message.sender === "AGENT") && message.content.trim());
  const first = customer[0]?.content;
  const last = customer.at(-1)?.content;
  const label = TRIGGER_LABELS[trigger as EscalationTrigger] ?? trigger;

  return [
    `Issue: ${first ? clip(first, 160) : clip(reason, 160)}`,
    last && last !== first ? `Latest from the customer: ${clip(last, 160)}` : null,
    `Tried so far: ${answers.length > 0 ? `the assistant replied ${answers.length} time(s); last answer: ${clip(answers.at(-1)!.content, 140)}` : "no answer was given yet"}`,
    `Mood: ${moodLabel(sentiment)}`,
    `Why it was escalated: ${label} - ${clip(reason, 160)}`,
    "Next step: read the latest message and reply to the customer directly.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function agentFor(agentId: string | null | undefined): Promise<AgentRuntimeConfig | null> {
  if (!agentId) return null;
  const agent = await prisma.aIAgent.findUnique({ where: { id: agentId }, omit: { apiKey: false } });
  return agent ? toRuntimeAgent(agent) : null;
}

export async function generateEscalationSummary(escalationId: string) {
  const escalation = await prisma.escalation.findUnique({
    where: { id: escalationId },
    include: {
      session: { select: { id: true, channel: true, chatbot: { select: { agentId: true } }, integration: { select: { agentId: true } } } },
      ticket: { select: { id: true, subject: true, inboxId: true } },
    },
  });

  if (!escalation || escalation.summary) {
    return escalation?.summary ?? null;
  }

  let messages: Line[] = [];
  let agent: AgentRuntimeConfig | null = null;

  if (escalation.session) {
    messages = (
      await prisma.chatMessage.findMany({
        where: { sessionId: escalation.session.id },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { sender: true, content: true },
      })
    ).reverse();
    agent = await agentFor(escalation.session.chatbot?.agentId ?? escalation.session.integration?.agentId);
  } else if (escalation.ticket) {
    const rows = await prisma.ticketMessage.findMany({
      where: { ticketId: escalation.ticket.id },
      orderBy: { createdAt: "asc" },
      take: 40,
      select: { sender: true, content: true },
    });
    messages = [
      { sender: "USER", content: `Subject: ${escalation.ticket.subject}` },
      ...rows.filter((row) => !row.content.startsWith("[[INTERNAL_NOTE]]")).map((row) => ({ sender: row.sender, content: row.content })),
    ];
    const inboxAgent = escalation.ticket.inboxId
      ? await prisma.aIAgent.findFirst({ where: { workspaceId: escalation.workspaceId, inboxId: escalation.ticket.inboxId, status: "ACTIVE" }, select: { id: true } })
      : null;
    agent = await agentFor(inboxAgent?.id);
  }

  const history = escalation.contactId
    ? await buildContactContext({
        workspaceId: escalation.workspaceId,
        contactId: escalation.contactId,
        currentChannel: escalation.channel,
        excludeSessionId: escalation.sessionId,
        excludeTicketId: escalation.ticketId,
      }).catch(() => ({ text: null }))
    : { text: null };

  const transcript = formatTranscript(messages, 5000);
  const fallback = fallbackEscalationSummary({ messages, trigger: escalation.trigger, reason: escalation.reason, sentiment: escalation.sentimentScore });
  let summary = fallback;

  if (transcript.trim()) {
    const raw = await generateCompletion({
      agent,
      system: SUMMARY_SYSTEM,
      prompt: [
        `This conversation was escalated. Reason: ${escalation.reason}`,
        history.text ? `<customer_history>\n${history.text}\n</customer_history>` : null,
        // Module 9 FE-2: a voice call's brief is built from what was said on the call.
        escalation.channel === "VOICE" ? "This was a voice call: the transcript below is what was said on the call." : null,
        `<transcript>\n${transcript}\n</transcript>`,
        "Write the hand-over brief as five short lines, each starting with its label: Issue:, Tried so far:, Mood:, Customer history:, Next step:. At most 90 words in total. Reply with only the brief inside <brief></brief> tags.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 500,
    }).catch(() => null);
    summary = extractTaggedOutput(raw, "brief") ?? fallback;
  }

  await prisma.escalation.update({
    where: { id: escalationId },
    data: { summary: summary.slice(0, 2000), summaryGeneratedAt: new Date() },
    select: { id: true },
  });

  if (escalation.sessionId) {
    publishConversationEvent({ workspaceId: escalation.workspaceId, sessionId: escalation.sessionId, type: "status" });
  }

  return summary;
}
