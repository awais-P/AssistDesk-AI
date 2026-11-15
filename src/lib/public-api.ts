import type { NextResponse } from "next/server";
import { type ApiContext, type ApiScope, apiError, authenticateApi, ok, pageResult, parsePage } from "./api-keys";
import { recordAudit } from "./audit";
import { isValidEmail } from "./auth";
import { resolveContact } from "./contacts";
import { listEscalations } from "./escalation-queries";
import { captureLead } from "./leads";
import { prisma } from "./prisma";
import { TicketNumberConflictError, createTicketWithMessage } from "./ticket-create";
import { processIncomingTicket } from "./ticket-workflow";

/**
 * Module 11 FE-2: the public REST API (/api/v1), for CRMs, help desks, e-commerce
 * back-ends and the business's own scripts. Every call is authenticated by an API key
 * with the right scope, rate limited per key, scoped to the key's workspace, and every
 * write is recorded in the audit log under the key's name.
 */

type Handler = (context: ApiContext, request: Request) => Promise<NextResponse>;

/** Wraps a handler with authentication, the scope check and JSON error handling. */
export function apiRoute(scope: ApiScope | null, handler: Handler) {
  return async (request: Request) => {
    const context = await authenticateApi(request, scope);

    if (!("keyId" in context)) {
      return context;
    }

    try {
      return await handler(context, request);
    } catch (error) {
      console.error("[api/v1] Request failed:", error);
      return apiError(500, "server_error", "Something went wrong on our side. Try again.");
    }
  };
}

async function readJson(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const cursorArgs = (cursor: string | null): { cursor?: { id: string }; skip?: number } => (cursor ? { cursor: { id: cursor }, skip: 1 } : {});

function audit(context: ApiContext, request: Request, action: string, summary: string, targetType: string, targetId: string) {
  return recordAudit({ workspaceId: context.workspaceId, actor: context.actor, action, category: "api", summary, targetType, targetId, request });
}

// ------------------------------------------------------------------ workspace

export async function describeKey(context: ApiContext) {
  const workspace = await prisma.workspace.findUnique({ where: { id: context.workspaceId }, select: { id: true, name: true } });
  return ok(context, { workspace, key: { name: context.keyName, scopes: context.scopes } });
}

// -------------------------------------------------------------------- tickets

const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

const ticketSelect = {
  id: true,
  ticketNumber: true,
  subject: true,
  status: true,
  priority: true,
  source: true,
  requesterName: true,
  requesterEmail: true,
  contactId: true,
  createdAt: true,
  updatedAt: true,
  inbox: { select: { ticketPrefix: true } },
  assignee: { select: { fullName: true } },
} as const;

function serializeTicket(ticket: { ticketNumber: number; inbox: { ticketPrefix: string | null } | null; assignee: { fullName: string } | null } & Record<string, unknown>) {
  const { inbox, assignee, ...rest } = ticket;
  return { ...rest, reference: `${inbox?.ticketPrefix ?? "T"}-${ticket.ticketNumber}`, assignee: assignee?.fullName ?? null };
}

export async function listTicketsApi(context: ApiContext, request: Request) {
  const url = new URL(request.url);
  const { limit, cursor } = parsePage(url);
  const status = url.searchParams.get("status");
  const email = url.searchParams.get("requester_email")?.toLowerCase();

  if (status && !TICKET_STATUSES.includes(status)) {
    return apiError(400, "invalid_status", `status must be one of ${TICKET_STATUSES.join(", ")}.`);
  }

  const rows = await prisma.ticket.findMany({
    where: { workspaceId: context.workspaceId, ...(status ? { status: status as never } : {}), ...(email ? { requesterEmail: email } : {}) },
    select: ticketSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...cursorArgs(cursor),
  });
  const page = pageResult(rows, limit);
  return ok(context, { data: page.data.map(serializeTicket), nextCursor: page.nextCursor });
}

export async function getTicketApi(context: ApiContext, id: string) {
  const ticket = await prisma.ticket.findFirst({
    where: { id, workspaceId: context.workspaceId },
    select: {
      ...ticketSelect,
      messages: { orderBy: { createdAt: "asc" }, select: { id: true, sender: true, authorName: true, content: true, createdAt: true } },
    },
  });

  if (!ticket) {
    return apiError(404, "not_found", "No ticket with this id in your workspace.");
  }

  const { messages, ...rest } = ticket;
  return ok(context, {
    data: {
      ...serializeTicket(rest),
      // Internal team notes are never exposed.
      messages: messages.filter((message) => !message.content.startsWith("[[INTERNAL_NOTE]]")),
    },
  });
}

export async function createTicketApi(context: ApiContext, request: Request) {
  const body = await readJson(request);

  if (!body) {
    return apiError(400, "invalid_json", "Send a JSON object.");
  }

  const subject = text(body.subject, 200);
  const message = text(body.message, 10_000);
  const requesterEmail = text(body.requester_email, 254).toLowerCase();
  const requesterName = text(body.requester_name, 120) || null;
  const priority = body.priority === undefined ? "MEDIUM" : String(body.priority);

  if (!subject || !message) {
    return apiError(400, "missing_fields", "subject and message are required.");
  }

  if (requesterEmail && !isValidEmail(requesterEmail)) {
    return apiError(400, "invalid_email", "requester_email is not a valid email address.");
  }

  if (!PRIORITIES.includes(priority)) {
    return apiError(400, "invalid_priority", `priority must be one of ${PRIORITIES.join(", ")}.`);
  }

  let ticketId: string;

  try {
    ticketId = await createTicketWithMessage({
      workspaceId: context.workspaceId,
      subject,
      previewText: message.slice(0, 300),
      message,
      requesterEmail: requesterEmail || null,
      requesterName,
      priority: priority as never,
      source: "MANUAL",
    });
  } catch (error) {
    if (error instanceof TicketNumberConflictError) {
      return apiError(409, "conflict", error.message);
    }
    throw error;
  }

  // Same automations as any new ticket (priority, tags, escalation check, AI reply in the background).
  await processIncomingTicket(ticketId, { deferAiReply: true });
  await audit(context, request, "api.ticket_created", `${context.actor.name} created a ticket: ${subject}`, "ticket", ticketId);
  return getTicketApi(context, ticketId).then(async (response) => ok(context, await response.json(), 201));
}

// ------------------------------------------------------------------- contacts

const contactSelect = { id: true, name: true, email: true, phone: true, lastChannel: true, firstSeenAt: true, lastSeenAt: true } as const;

export async function listContactsApi(context: ApiContext, request: Request) {
  const url = new URL(request.url);
  const { limit, cursor } = parsePage(url);
  const email = url.searchParams.get("email")?.toLowerCase();
  const rows = await prisma.contact.findMany({
    where: { workspaceId: context.workspaceId, ...(email ? { email } : {}) },
    select: contactSelect,
    orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...cursorArgs(cursor),
  });
  return ok(context, pageResult(rows, limit));
}

export async function upsertContactApi(context: ApiContext, request: Request) {
  const body = await readJson(request);

  if (!body) {
    return apiError(400, "invalid_json", "Send a JSON object.");
  }

  const email = text(body.email, 254).toLowerCase();
  const phone = text(body.phone, 40);
  const name = text(body.name, 120) || null;

  if (!email && !phone) {
    return apiError(400, "missing_fields", "email or phone is required.");
  }

  if (email && !isValidEmail(email)) {
    return apiError(400, "invalid_email", "email is not a valid email address.");
  }

  const contact = await resolveContact(context.workspaceId, { name, email: email || null, phone: phone || null }, "EMAIL");

  if (!contact) {
    return apiError(400, "invalid_contact", "These details could not be saved as a customer.");
  }

  await audit(context, request, "api.contact_saved", `${context.actor.name} saved the customer ${email || phone}`, "contact", contact.id);
  const saved = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id }, select: contactSelect });
  return ok(context, { data: saved }, 201);
}

// ---------------------------------------------------------------------- leads

const leadSelect = { id: true, name: true, email: true, phone: true, company: true, status: true, source: true, score: true, intent: true, contactId: true, crmId: true, createdAt: true, lastActivityAt: true } as const;

export async function listLeadsApi(context: ApiContext, request: Request) {
  const url = new URL(request.url);
  const { limit, cursor } = parsePage(url);
  const status = url.searchParams.get("status");
  const rows = await prisma.lead.findMany({
    where: { workspaceId: context.workspaceId, ...(status ? { status: status as never } : {}) },
    select: leadSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...cursorArgs(cursor),
  });
  return ok(context, pageResult(rows, limit));
}

export async function createLeadApi(context: ApiContext, request: Request) {
  const body = await readJson(request);

  if (!body) {
    return apiError(400, "invalid_json", "Send a JSON object.");
  }

  const email = text(body.email, 254).toLowerCase() || null;
  const phone = text(body.phone, 40) || null;

  if (!email && !phone) {
    return apiError(400, "missing_fields", "email or phone is required.");
  }

  if (email && !isValidEmail(email)) {
    return apiError(400, "invalid_email", "email is not a valid email address.");
  }

  const { lead, created } = await captureLead({
    workspaceId: context.workspaceId,
    channel: "EMAIL",
    source: "API",
    values: { name: text(body.name, 120) || null, email, phone, company: text(body.company, 120) || null, fields: [] },
    intentHint: text(body.interest, 400) || null,
    actorName: context.actor.name,
  });

  await audit(context, request, created ? "api.lead_created" : "api.lead_updated", `${context.actor.name} ${created ? "created" : "updated"} a lead for ${email ?? phone}`, "lead", lead.id);
  const saved = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, select: leadSelect });
  return ok(context, { data: saved, created }, created ? 201 : 200);
}

// -------------------------------------------------------------- conversations

const conversationSelect = {
  id: true,
  channel: true,
  status: true,
  customerName: true,
  customerEmail: true,
  contactId: true,
  summary: true,
  resolution: true,
  messageCount: true,
  startedAt: true,
  lastActivityAt: true,
  endedAt: true,
} as const;

export async function listConversationsApi(context: ApiContext, request: Request) {
  const url = new URL(request.url);
  const { limit, cursor } = parsePage(url);
  const status = url.searchParams.get("status");
  const channel = url.searchParams.get("channel");
  const rows = await prisma.chatSession.findMany({
    where: { workspaceId: context.workspaceId, ...(status ? { status: status as never } : {}), ...(channel ? { channel: channel as never } : {}) },
    select: conversationSelect,
    orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...cursorArgs(cursor),
  });
  return ok(context, pageResult(rows, limit));
}

export async function getConversationApi(context: ApiContext, id: string) {
  const conversation = await prisma.chatSession.findFirst({
    where: { id, workspaceId: context.workspaceId },
    select: { ...conversationSelect, messages: { orderBy: { createdAt: "asc" }, select: { id: true, sender: true, authorName: true, content: true, createdAt: true } } },
  });

  return conversation ? ok(context, { data: conversation }) : apiError(404, "not_found", "No conversation with this id in your workspace.");
}

// ---------------------------------------------------------------- escalations

export async function listEscalationsApi(context: ApiContext, request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("status") ?? "all";
  const view = requested === "PENDING" ? "queue" : requested === "ACCEPTED" ? "in_progress" : requested === "RESOLVED" ? "resolved" : "all";
  const items = await listEscalations({ workspaceId: context.workspaceId, userId: "", view, take: parsePage(url).limit });
  return ok(context, {
    data: items.map((item) => ({
      id: item.id,
      status: item.status,
      trigger: item.trigger,
      reason: item.reason,
      priority: item.priority,
      channel: item.channel,
      customer: item.customer,
      summary: item.summary,
      assignee: item.assignee?.fullName ?? null,
      conversationId: item.session?.id ?? null,
      ticketId: item.ticket?.id ?? null,
      slaBreached: item.slaBreached,
      createdAt: item.createdAt,
      resolvedAt: item.resolvedAt,
      resolution: item.resolution,
    })),
  });
}
