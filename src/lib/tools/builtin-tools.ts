import { Prisma } from "@/app/generated/prisma/client";
import { normalizeEmail, normalizePhone } from "../identity";
import { retrieveKnowledgeMatches } from "../knowledge-runtime";
import { captureLead } from "../leads";
import { createNotification } from "../notifications";
import { prisma } from "../prisma";
import { publishConversationEvent } from "../realtime";
import { appendSessionMessage, recordSessionEvent } from "../session-lifecycle";
import { maskEmail, maskPhone } from "../session-memory";
import { bookAppointment, findFreeSlots } from "./appointments";
import { formatSlot } from "./appointments-math";
import type { ToolInputValues, ToolParameter } from "./tool-schema";

/**
 * Module 2 FE-1 built-in actions. They run inside AssistDesk and use the data of the
 * other modules: tickets, contacts (M5), leads (M8), human takeover (M5/M9) and
 * appointments. Every executor gets the conversation context, and none of them can
 * read another customer's data.
 */

export type ToolChannel = "WEB_WIDGET" | "WHATSAPP" | "SLACK" | "EMAIL" | "VOICE" | "PLAYGROUND";

export type ToolContext = {
  workspaceId: string;
  agentId: string | null;
  runId: string | null;
  step: number;
  sessionId: string | null;
  ticketId: string | null;
  contactId: string | null;
  channel: ToolChannel;
  /** The person is known to be this customer (M5 trust level). */
  verifiedIdentity: boolean;
  customer: { name: string | null; email: string | null; phone: string | null };
  /** Workspace time zone, for dates shown to the customer. */
  timeZone: string;
  /** Playground: reads run, writes are simulated. */
  dryRun: boolean;
  triggeredBy: "MODEL" | "RULE" | "CONFIRMATION" | "TEST";
  /**
   * The customer's current message is a clear "yes" to the assistant's last question.
   * One action needing confirmation may then run without asking a second time.
   * Shared by reference across the run, so it is used at most once.
   */
  customerConsent?: { message: string; used: boolean } | null;
};

export type BuiltInDefinition = {
  key: string;
  name: string;
  description: string;
  parameters: ToolParameter[];
  /** Ask the customer "shall I go ahead?" before running (writes with consequences). */
  requiresConfirmation: boolean;
  /** READ tools also run in dry-run mode; WRITE tools are simulated there. */
  effect: "READ" | "WRITE";
  /** Human sentence for the confirmation question and the log. */
  summarize: (values: ToolInputValues, ctx: ToolContext) => string;
  execute: (values: ToolInputValues, ctx: ToolContext) => Promise<unknown>;
};

export class ToolError extends Error {}

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Contact details the model passes in. Values we showed it masked ("s***@x.com",
 * "*******4567") are never stored: the customer's real details from the session are used.
 */
const isMasked = (value: string | null) => Boolean(value && /\*{2,}|•/.test(value));
const contactEmail = (value: unknown, ctx: ToolContext) => {
  const raw = str(value);
  return (isMasked(raw) ? null : normalizeEmail(raw)) ?? ctx.customer.email;
};
const contactPhone = (value: unknown, ctx: ToolContext) => {
  const raw = str(value);
  return (isMasked(raw) ? null : normalizePhone(raw)) ?? ctx.customer.phone;
};

function ticketReference(prefix: string | null | undefined, number: number) {
  return `${prefix ?? "AD"}-${number}`;
}

/** "AD-458103", "#458103", "ticket 458103" → 458103. */
export function parseTicketNumber(value: string) {
  const match = value.match(/(\d{3,10})/);
  return match ? Number(match[1]) : null;
}

const getCustomerInfo: BuiltInDefinition = {
  key: "get_customer_info",
  name: "Get customer info",
  description:
    "Look up what we know about the customer in this conversation: name, contact details (masked), channels used, open tickets, lead status and upcoming appointments. Use it before asking the customer for details we may already have.",
  parameters: [],
  requiresConfirmation: false,
  effect: "READ",
  summarize: () => "Look up the customer's record",
  async execute(_values, ctx) {
    if (!ctx.contactId) {
      return {
        known: false,
        note: "This customer has no record yet. Ask for their name and email or phone if you need them.",
        sharedInThisConversation: {
          name: ctx.customer.name,
          email: ctx.customer.email ? maskEmail(ctx.customer.email) : null,
          phone: ctx.customer.phone ? maskPhone(ctx.customer.phone) : null,
        },
      };
    }

    const contact = await prisma.contact.findFirst({
      where: { id: ctx.contactId, workspaceId: ctx.workspaceId },
      include: {
        sessions: { select: { channel: true }, take: 50 },
        tickets: {
          where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { ticketNumber: true, subject: true, status: true, inbox: { select: { ticketPrefix: true } } },
        },
        leads: { orderBy: { lastActivityAt: "desc" }, take: 1, select: { status: true, intent: true } },
        appointments: {
          where: { status: "BOOKED", startsAt: { gte: new Date() } },
          orderBy: { startsAt: "asc" },
          take: 3,
          select: { startsAt: true, topic: true },
        },
      },
    });

    if (!contact) {
      return { known: false };
    }

    const timeZone = ctx.timeZone;

    return {
      known: true,
      verified: ctx.verifiedIdentity,
      name: contact.name,
      email: contact.email ? maskEmail(contact.email) : null,
      phone: contact.phone ? maskPhone(contact.phone) : null,
      channels: [...new Set(contact.sessions.map((session) => session.channel))],
      customerSince: contact.firstSeenAt.toISOString().slice(0, 10),
      // Ticket subjects and appointments are withheld from visitors we cannot verify.
      openTickets: ctx.verifiedIdentity
        ? contact.tickets.map((ticket) => ({ reference: ticketReference(ticket.inbox?.ticketPrefix, ticket.ticketNumber), subject: ticket.subject, status: ticket.status }))
        : contact.tickets.length,
      lead: contact.leads[0] ? { status: contact.leads[0].status, interest: ctx.verifiedIdentity ? contact.leads[0].intent : null } : null,
      upcomingAppointments: ctx.verifiedIdentity
        ? contact.appointments.map((appointment) => ({ when: formatSlot(appointment.startsAt, timeZone), topic: appointment.topic }))
        : contact.appointments.length,
    };
  },
};

const lookupTicketStatus: BuiltInDefinition = {
  key: "lookup_ticket_status",
  name: "Look up ticket status",
  description:
    "Get the status of one of the customer's support tickets from its reference (for example AD-458103 or #458103). Only the customer's own tickets can be read.",
  parameters: [{ name: "reference", type: "string", description: "The ticket reference or number the customer gave.", required: true }],
  requiresConfirmation: false,
  effect: "READ",
  summarize: (values) => `Look up ticket ${values.reference}`,
  async execute(values, ctx) {
    const number = parseTicketNumber(String(values.reference));

    if (!number) {
      throw new ToolError("That does not look like a ticket reference. Ask the customer for the number in their confirmation email, like AD-458103.");
    }

    const ticket = await prisma.ticket.findFirst({
      where: { workspaceId: ctx.workspaceId, ticketNumber: number },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        contactId: true,
        requesterEmail: true,
        inbox: { select: { ticketPrefix: true } },
        assignee: { select: { fullName: true } },
        messages: {
          where: { sender: { in: ["AGENT", "AI"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { sender: true, createdAt: true },
        },
      },
    });

    const ownsTicket =
      ticket &&
      ((ctx.contactId && ticket.contactId === ctx.contactId) ||
        (ctx.verifiedIdentity && ctx.customer.email && ticket.requesterEmail?.toLowerCase() === ctx.customer.email.toLowerCase()));

    // The same answer whether the ticket doesn't exist or isn't theirs: no enumeration.
    if (!ticket || !ownsTicket) {
      return { found: false, note: "No ticket with that reference was found for this customer. Ask them to check the reference, or offer to create a new ticket." };
    }

    return {
      found: true,
      reference: ticketReference(ticket.inbox?.ticketPrefix, ticket.ticketNumber),
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      openedOn: ticket.createdAt.toISOString().slice(0, 10),
      lastUpdated: ticket.updatedAt.toISOString().slice(0, 10),
      handledBy: ticket.assignee?.fullName ? "a member of our team" : "our team (not assigned yet)",
      lastReply: ticket.messages[0] ? { from: ticket.messages[0].sender === "AGENT" ? "team" : "assistant", on: ticket.messages[0].createdAt.toISOString().slice(0, 10) } : null,
    };
  },
};

const MAX_TICKET_ATTEMPTS = 3;

const createTicket: BuiltInDefinition = {
  key: "create_ticket",
  name: "Create support ticket",
  description:
    "Open a support ticket for a problem that needs the team's follow-up (refunds, damaged items, account problems, anything you cannot solve in chat). Give a short subject and a full description of what the customer needs. Tell the customer the ticket reference afterwards.",
  parameters: [
    { name: "subject", type: "string", description: "Short summary, e.g. 'Damaged kettle, wants a replacement'.", required: true },
    { name: "description", type: "string", description: "Everything the team needs: what happened, order numbers, what the customer wants.", required: true },
    { name: "priority", type: "string", description: "How urgent it is.", required: false, enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
  ],
  requiresConfirmation: false,
  effect: "WRITE",
  summarize: (values) => `Create a ticket: "${values.subject}"`,
  async execute(values, ctx) {
    const subject = String(values.subject).slice(0, 200);
    const description = String(values.description).slice(0, 4000);
    const priority = (values.priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT" | undefined) ?? "MEDIUM";

    if (ctx.dryRun) {
      return { simulated: true, note: "Test mode: no ticket was created.", reference: "AD-TEST", subject, priority };
    }

    const inbox = await prisma.inbox.findFirst({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "asc" }, select: { id: true, ticketPrefix: true } });
    const source = ctx.channel === "WHATSAPP" ? "WHATSAPP" : ctx.channel === "SLACK" ? "SLACK" : ctx.channel === "EMAIL" ? "EMAIL" : "WEB";

    for (let attempt = 1; ; attempt += 1) {
      const last = await prisma.ticket.findFirst({ where: { workspaceId: ctx.workspaceId }, orderBy: { ticketNumber: "desc" }, select: { ticketNumber: true } });

      try {
        const ticket = await prisma.ticket.create({
          data: {
            workspaceId: ctx.workspaceId,
            inboxId: inbox?.id ?? null,
            ticketNumber: (last?.ticketNumber ?? 458102) + 1,
            subject,
            previewText: description.slice(0, 300),
            requesterName: ctx.customer.name,
            requesterEmail: ctx.customer.email,
            contactId: ctx.contactId,
            source,
            status: "OPEN",
            priority,
            messages: {
              create: {
                workspaceId: ctx.workspaceId,
                sender: "USER",
                content: `${subject}\n\n${description}${ctx.sessionId ? "\n\n(Created by the AI assistant from a chat conversation.)" : ""}`,
                authorName: ctx.customer.name,
              },
            },
          },
          select: { id: true, ticketNumber: true },
        });
        const reference = ticketReference(inbox?.ticketPrefix, ticket.ticketNumber);

        await createNotification({
          workspaceId: ctx.workspaceId,
          type: "NEW_TICKET",
          title: `AI opened ticket ${reference}: ${subject}`,
          body: ctx.customer.name ?? ctx.customer.email ?? "From a chat conversation",
          link: `/dashboard/tickets/${ticket.id}`,
        });

        if (ctx.sessionId) {
          await recordSessionEvent({
            workspaceId: ctx.workspaceId,
            sessionId: ctx.sessionId,
            contactId: ctx.contactId,
            type: "TICKET_CREATED",
            detail: `AI opened ticket ${reference}.`,
            metadata: { ticketId: ticket.id },
          });
        }

        return {
          created: true,
          reference,
          priority,
          followUp: ctx.customer.email ? "The team will reply by email." : "The team will follow up in this conversation.",
        };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") || attempt >= MAX_TICKET_ATTEMPTS) {
          throw error;
        }
      }
    }
  },
};

const captureLeadTool: BuiltInDefinition = {
  key: "capture_lead",
  name: "Capture sales lead",
  description:
    "Save the customer as a sales lead when they are interested in buying (prices, quotes, bulk orders, demos) and have shared a way to reach them. Include what they are interested in.",
  parameters: [
    { name: "interest", type: "string", description: "What they want to buy or learn about, with quantities or budget if mentioned.", required: true },
    { name: "name", type: "string", description: "Customer name, if given.", required: false },
    { name: "email", type: "string", description: "Email, if given.", required: false },
    { name: "phone", type: "string", description: "Phone number with country code, if given.", required: false },
    { name: "company", type: "string", description: "Company, if given.", required: false },
  ],
  requiresConfirmation: false,
  effect: "WRITE",
  summarize: (values) => `Save a sales lead: ${values.interest}`,
  async execute(values, ctx) {
    const email = contactEmail(values.email, ctx);
    const phone = contactPhone(values.phone, ctx);

    if (!email && !phone) {
      throw new ToolError("Ask the customer for an email or phone number first, so the sales team can reach them.");
    }

    if (ctx.dryRun) {
      return { simulated: true, note: "Test mode: no lead was saved.", email, phone };
    }

    const { lead, created } = await captureLead({
      workspaceId: ctx.workspaceId,
      channel: ctx.channel === "PLAYGROUND" ? "WEB_WIDGET" : ctx.channel,
      source: "AI_TOOL",
      values: { name: str(values.name) ?? ctx.customer.name, email, phone, company: str(values.company), fields: [] },
      sessionId: ctx.sessionId,
      contactId: ctx.contactId,
      intentHint: String(values.interest).slice(0, 120),
      actorName: "AI assistant",
    });

    if (created || !lead.intent) {
      await prisma.lead.update({ where: { id: lead.id }, data: { intent: String(values.interest).slice(0, 400) }, select: { id: true } });
    }

    return { saved: true, newLead: created, status: lead.status, note: "Tell the customer the sales team will contact them." };
  },
};

const escalateToHuman: BuiltInDefinition = {
  key: "escalate_to_human",
  name: "Hand over to a human",
  description:
    "Hand the conversation to a human team member when the customer asks for a person, is upset, or needs something you cannot do. Summarise what they need so the team does not have to ask again. After this the AI stops replying in this conversation.",
  parameters: [{ name: "summary", type: "string", description: "What the customer needs and what was already tried.", required: true }],
  requiresConfirmation: false,
  effect: "WRITE",
  summarize: (values) => `Hand over to a human: ${values.summary}`,
  async execute(values, ctx) {
    const summary = String(values.summary).slice(0, 500);

    if (ctx.dryRun) {
      return { simulated: true, note: "Test mode: the conversation was not handed over." };
    }

    if (ctx.sessionId) {
      const session = await prisma.chatSession.findFirst({ where: { id: ctx.sessionId, workspaceId: ctx.workspaceId }, select: { status: true } });

      if (session?.status === "CLOSED") {
        throw new ToolError("This conversation has already ended.");
      }

      await prisma.chatSession.update({ where: { id: ctx.sessionId }, data: { status: "ESCALATED" }, select: { id: true } });
      await recordSessionEvent({
        workspaceId: ctx.workspaceId,
        sessionId: ctx.sessionId,
        contactId: ctx.contactId,
        type: "HUMAN_TAKEOVER",
        detail: `AI handed the conversation to the team: ${summary}`,
        metadata: { trigger: "ai_tool", runId: ctx.runId },
      });
      await appendSessionMessage({
        sessionId: ctx.sessionId,
        workspaceId: ctx.workspaceId,
        sender: "SYSTEM",
        content: "The AI assistant has asked a team member to join this conversation.",
      });
      publishConversationEvent({ workspaceId: ctx.workspaceId, sessionId: ctx.sessionId, type: "status" });
    } else if (ctx.ticketId) {
      await prisma.ticketMessage.create({
        data: { workspaceId: ctx.workspaceId, ticketId: ctx.ticketId, sender: "SYSTEM", content: `[[INTERNAL_NOTE]]\nAI asked for a human: ${summary}` },
      });
    }

    await createNotification({
      workspaceId: ctx.workspaceId,
      type: "CHAT_WAITING",
      severity: "WARNING",
      title: `AI handed over ${ctx.customer.name ?? "a customer"} to the team`,
      body: summary,
      link: ctx.sessionId ? `/dashboard/chats?session=${ctx.sessionId}` : ctx.ticketId ? `/dashboard/tickets/${ctx.ticketId}` : "/dashboard/chats",
    });

    return { handedOver: true, note: "Tell the customer a team member will reply here shortly." };
  },
};

const checkAvailability: BuiltInDefinition = {
  key: "check_availability",
  name: "Check appointment availability",
  description:
    "List free appointment slots (consultations, demos, service visits). Optionally for one date. Offer the customer a few options using the labels, and use the exact startsAt value when booking.",
  parameters: [{ name: "date", type: "string", description: "Optional day in YYYY-MM-DD format (the customer's preferred date).", required: false }],
  requiresConfirmation: false,
  effect: "READ",
  summarize: (values) => `Check free slots${values.date ? ` on ${values.date}` : ""}`,
  async execute(values, ctx) {
    const date = str(values.date);

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ToolError("Use the date format YYYY-MM-DD.");
    }

    const result = await findFreeSlots(ctx.workspaceId, date);

    return {
      timeZone: result.timeZone,
      slotMinutes: result.slotMinutes,
      slots: result.slots,
      note: result.slots.length === 0 ? "No free slots in that period. Offer another day." : "Offer two or three of these; book with the exact startsAt value.",
    };
  },
};

const bookAppointmentTool: BuiltInDefinition = {
  key: "book_appointment",
  name: "Book appointment",
  description:
    "Book an appointment in a free slot from check_availability. Needs the customer's name and an email or phone. The customer is asked to confirm before it is booked.",
  parameters: [
    { name: "starts_at", type: "string", description: "The exact startsAt value of the chosen slot (ISO time from check_availability).", required: true },
    { name: "name", type: "string", description: "Customer name.", required: false },
    { name: "email", type: "string", description: "Customer email.", required: false },
    { name: "phone", type: "string", description: "Customer phone with country code.", required: false },
    { name: "topic", type: "string", description: "What the appointment is about.", required: false },
  ],
  requiresConfirmation: true,
  effect: "WRITE",
  summarize: (values, ctx) => {
    const date = new Date(String(values.starts_at));
    const when = Number.isNaN(date.getTime()) ? String(values.starts_at) : formatSlot(date, ctx.timeZone);
    return `Book an appointment on ${when} for ${str(values.name) ?? ctx.customer.name ?? "the customer"}${values.topic ? ` about ${values.topic}` : ""}`;
  },
  async execute(values, ctx) {
    const startsAt = new Date(String(values.starts_at));
    const name = str(values.name) ?? ctx.customer.name;
    const email = contactEmail(values.email, ctx);
    const phone = contactPhone(values.phone, ctx);

    if (Number.isNaN(startsAt.getTime())) {
      throw new ToolError("Use the exact startsAt value from check_availability.");
    }

    if (!name || (!email && !phone)) {
      throw new ToolError("Ask the customer for their name and an email or phone number before booking.");
    }

    if (ctx.dryRun) {
      return { simulated: true, note: "Test mode: nothing was booked.", startsAt: startsAt.toISOString() };
    }

    const result = await bookAppointment({
      workspaceId: ctx.workspaceId,
      startsAt,
      name,
      email,
      phone,
      topic: str(values.topic),
      contactId: ctx.contactId,
      sessionId: ctx.sessionId,
      createdBy: "AI",
    });

    if (!result.ok) {
      throw new ToolError(`${result.reason} Check availability again and offer other slots.`);
    }

    if (ctx.sessionId) {
      await recordSessionEvent({
        workspaceId: ctx.workspaceId,
        sessionId: ctx.sessionId,
        contactId: ctx.contactId,
        type: "APPOINTMENT_BOOKED",
        detail: `AI booked an appointment for ${formatSlot(startsAt, result.timeZone)}.`,
        metadata: { appointmentId: result.appointment.id },
      });
    }

    return {
      booked: true,
      when: formatSlot(startsAt, result.timeZone),
      timeZone: result.timeZone,
      durationMinutes: result.appointment.durationMinutes,
      bookedFor: email ? maskEmail(email) : phone ? maskPhone(phone) : null,
      // Nothing is emailed automatically: keep the model from promising a confirmation email.
      note: "Tell the customer the day and time. Do not say that an email or SMS confirmation was sent.",
    };
  },
};

const searchKnowledgeBase: BuiltInDefinition = {
  key: "search_knowledge_base",
  name: "Search knowledge base",
  description:
    "Search the company's knowledge base for a specific topic when the passages you already have don't cover the customer's question (policies, product details, procedures).",
  parameters: [{ name: "query", type: "string", description: "What to look for, in a few words.", required: true }],
  requiresConfirmation: false,
  effect: "READ",
  summarize: (values) => `Search the knowledge base for "${values.query}"`,
  async execute(values, ctx) {
    if (!ctx.agentId) {
      return { results: [] };
    }

    const sources = await prisma.knowledgeSource.findMany({
      where: { agentId: ctx.agentId, workspaceId: ctx.workspaceId, status: { not: "DELETED" } },
      select: { id: true, title: true, type: true, status: true, sourceUrl: true, rawText: true },
    });
    const matches = await retrieveKnowledgeMatches(String(values.query), sources);

    return {
      results: matches.slice(0, 3).map((match) => ({ source: match.title, passage: match.excerpt.slice(0, 1200), score: Math.round(match.score * 100) / 100 })),
    };
  },
};

export const BUILT_IN_TOOLS: BuiltInDefinition[] = [
  getCustomerInfo,
  lookupTicketStatus,
  createTicket,
  captureLeadTool,
  escalateToHuman,
  checkAvailability,
  bookAppointmentTool,
  searchKnowledgeBase,
];

export const BUILT_IN_BY_KEY = new Map(BUILT_IN_TOOLS.map((tool) => [tool.key, tool]));
