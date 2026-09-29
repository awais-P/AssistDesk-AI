import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { loadContactDetail } from "@/src/lib/contact-list";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";
import { recordSessionEvent } from "@/src/lib/session-lifecycle";

type ContactRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const MAX_MEMORY_LENGTH = 2000;

/** One customer's cross-channel history: sessions, tickets and the memory audit trail. */
export async function GET(_request: Request, context: ContactRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const detail = await loadContactDetail(session.user.workspaceId, id);

  if (!detail) {
    return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }

  return NextResponse.json(detail);
}

/**
 * Correct the customer's name or their AI memory (e.g. remove a wrong fact).
 * `memory: null` clears it; it is rebuilt when their next conversation ends.
 */
export async function PATCH(request: Request, context: ContactRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; memory?: unknown };
  const data: { name?: string | null; memory?: string | null; memoryUpdatedAt?: Date } = {};

  if (body.name !== undefined) {
    if (body.name !== null && typeof body.name !== "string") {
      return NextResponse.json({ error: "Name must be text." }, { status: 400 });
    }

    data.name = body.name?.trim().slice(0, 120) || null;
  }

  if (body.memory !== undefined) {
    if (body.memory !== null && typeof body.memory !== "string") {
      return NextResponse.json({ error: "Memory must be text." }, { status: 400 });
    }

    if (typeof body.memory === "string" && body.memory.length > MAX_MEMORY_LENGTH) {
      return NextResponse.json(
        { error: `Memory can be up to ${MAX_MEMORY_LENGTH} characters.` },
        { status: 400 },
      );
    }

    data.memory = body.memory?.trim() || null;
    data.memoryUpdatedAt = new Date();
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const result = await prisma.contact.updateMany({
    where: { id, workspaceId: session.user.workspaceId },
    data,
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }

  if (data.memory !== undefined) {
    await recordSessionEvent({
      workspaceId: session.user.workspaceId,
      contactId: id,
      type: "MEMORY_EDITED",
      detail: `${session.user.fullName} ${data.memory ? "edited" : "cleared"} the customer's AI memory.`,
      metadata: { userId: session.user.id },
    });
  }

  return NextResponse.json({ success: true });
}

/**
 * "Forget this customer" (privacy request): deletes the Contact, so no channel links
 * to it and the AI loses its memory of them. With `?erase=conversations` their chat
 * sessions (and messages) are deleted too; tickets are business records and stay,
 * unlinked. Manager role or higher.
 */
export async function DELETE(request: Request, context: ContactRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const eraseConversations = new URL(request.url).searchParams.get("erase") === "conversations";
  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    select: { id: true, _count: { select: { sessions: true, tickets: true } } },
  });

  if (!contact) {
    return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    if (eraseConversations) {
      await tx.chatSession.deleteMany({ where: { contactId: contact.id } });
    } else {
      // Keep the transcripts for the team, but drop what identifies the person.
      await tx.chatSession.updateMany({
        where: { contactId: contact.id },
        data: { customerName: null, customerEmail: null, customerPhone: null, summary: null, clientIpHash: null },
      });
    }

    await tx.sessionEvent.deleteMany({ where: { contactId: contact.id } });
    await tx.contact.delete({ where: { id: contact.id } });
  });

  await recordSessionEvent({
    workspaceId: session.user.workspaceId,
    type: "CONTACT_ERASED",
    detail: `${session.user.fullName} erased a customer record (${contact._count.sessions} conversation(s) ${eraseConversations ? "deleted" : "anonymised"}, ${contact._count.tickets} ticket(s) unlinked).`,
    metadata: { userId: session.user.id, eraseConversations },
  });

  return NextResponse.json({ success: true, eraseConversations });
}
