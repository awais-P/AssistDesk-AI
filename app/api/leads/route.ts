import { NextResponse } from "next/server";
import type { LeadStatus } from "@/app/generated/prisma/client";
import { getCurrentSession } from "@/src/lib/auth";
import { normalizeEmail, normalizePhone } from "@/src/lib/identity";
import { LEAD_STATUSES } from "@/src/lib/lead-form";
import { loadLeadList, parseLeadFilters } from "@/src/lib/lead-list";
import { captureLead, updateLead } from "@/src/lib/leads";
import { prisma } from "@/src/lib/prisma";
import { processDueDeliveries } from "@/src/lib/webhooks";

/** Lead database (Module 8 FE-5) with filters, sorting and pagination (SRS UI-4). */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Webhook retries that are due are sent while the team is looking (no cron needed locally).
  void processDueDeliveries({ workspaceId: session.user.workspaceId, limit: 10 }).catch(() => undefined);

  const result = await loadLeadList(
    session.user.workspaceId,
    parseLeadFilters(new URL(request.url).searchParams),
    session.user.id,
  );

  return NextResponse.json(result);
}

type CreateLeadPayload = {
  sessionId?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  company?: unknown;
  intent?: unknown;
  status?: unknown;
  ownerId?: unknown;
};

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * The team adds a lead: from a conversation (`sessionId`, e.g. "Create lead" on the
 * Chats page, which uses the customer's known details) or by typing the details.
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as CreateLeadPayload;
  const { workspaceId } = session.user;
  const sessionId = text(body.sessionId, 40) || null;
  const chat = sessionId
    ? await prisma.chatSession.findFirst({
        where: { id: sessionId, workspaceId },
        select: {
          id: true,
          channel: true,
          chatbotId: true,
          contactId: true,
          customerName: true,
          customerEmail: true,
          customerPhone: true,
          contact: { select: { name: true, email: true, phone: true } },
        },
      })
    : null;

  if (sessionId && !chat) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const rawEmail = text(body.email, 160);
  const rawPhone = text(body.phone, 32);
  const email = rawEmail ? normalizeEmail(rawEmail) : chat?.customerEmail ?? chat?.contact?.email ?? null;
  const phone = rawPhone ? normalizePhone(rawPhone) : chat?.customerPhone ?? chat?.contact?.phone ?? null;

  if (rawEmail && !email) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (rawPhone && !phone) {
    return NextResponse.json({ error: "Enter a valid phone number with country code." }, { status: 400 });
  }

  if (!email && !phone) {
    return NextResponse.json(
      {
        error: chat
          ? "This customer has not shared an email or phone number yet, so there is no way to follow up."
          : "Add an email or phone number.",
      },
      { status: 400 },
    );
  }

  const ownerId = text(body.ownerId, 40) || null;

  if (ownerId && !(await prisma.user.count({ where: { id: ownerId, workspaceId, isActive: true } }))) {
    return NextResponse.json({ error: "That owner is not an active member of this workspace." }, { status: 400 });
  }

  const { lead, created } = await captureLead({
    workspaceId,
    channel: (chat?.channel as "WEB_WIDGET" | "WHATSAPP" | "SLACK" | "EMAIL" | "VOICE" | undefined) ?? "WEB_WIDGET",
    source: "MANUAL",
    values: {
      name: text(body.name, 120) || chat?.customerName || chat?.contact?.name || null,
      email,
      phone,
      company: text(body.company, 120) || null,
      fields: [],
    },
    chatbotId: chat?.chatbotId ?? null,
    sessionId: chat?.id ?? null,
    contactId: chat?.contactId ?? null,
    ownerId: ownerId ?? session.user.id,
    actorName: session.user.fullName,
  });

  const status = text(body.status, 20) as LeadStatus;
  const intent = text(body.intent, 400);

  const final =
    ((LEAD_STATUSES as readonly string[]).includes(status) && status !== lead.status) || intent
      ? await updateLead(
          workspaceId,
          lead.id,
          {
            ...((LEAD_STATUSES as readonly string[]).includes(status) ? { status } : {}),
            ...(intent ? { intent } : {}),
          },
          session.user.fullName,
        )
      : lead;

  return NextResponse.json({ lead: final, created }, { status: created ? 201 : 200 });
}
