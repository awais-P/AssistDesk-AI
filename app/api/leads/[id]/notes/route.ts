import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type LeadNotesRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const MAX_NOTE_LENGTH = 2000;

/** A follow-up note on the lead's timeline ("Called, wants a quote by Friday"). */
export async function POST(request: Request, context: LeadNotesRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "Write a note first." }, { status: 400 });
  }

  if (text.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: `Notes can be up to ${MAX_NOTE_LENGTH} characters.` }, { status: 400 });
  }

  const lead = await prisma.lead.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    select: { id: true },
  });

  if (!lead) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const [event] = await prisma.$transaction([
    prisma.leadEvent.create({
      data: {
        workspaceId: session.user.workspaceId,
        leadId: id,
        type: "NOTE",
        detail: text,
        actorName: session.user.fullName,
        metadata: { userId: session.user.id },
      },
      select: { id: true, type: true, detail: true, actorName: true, createdAt: true },
    }),
    prisma.lead.update({ where: { id }, data: { lastActivityAt: new Date() }, select: { id: true } }),
  ]);

  return NextResponse.json({ event: { ...event, createdAt: event.createdAt.toISOString() } }, { status: 201 });
}
