import { NextResponse } from "next/server";
import type { LeadStatus } from "@/app/generated/prisma/client";
import { getCurrentSession } from "@/src/lib/auth";
import { normalizeEmail, normalizePhone } from "@/src/lib/identity";
import { LEAD_STATUSES } from "@/src/lib/lead-form";
import { loadLeadDetail } from "@/src/lib/lead-detail";
import { type LeadPatch, updateLead } from "@/src/lib/leads";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";
import { enqueueWebhookEvent } from "@/src/lib/webhooks";

type LeadRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/** One lead with its timeline, webhook deliveries and conversation excerpt. */
export async function GET(_request: Request, context: LeadRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const detail = await loadLeadDetail(session.user.workspaceId, id);

  if (!detail) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  return NextResponse.json(detail);
}

type LeadPatchPayload = {
  status?: unknown;
  ownerId?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  company?: unknown;
  intent?: unknown;
};

function optionalText(value: unknown, max: number) {
  if (value === null) return null;
  return typeof value === "string" ? value.trim().slice(0, max) || null : undefined;
}

/** Follow-up work: status, owner and corrected details (every change is on the timeline). */
export async function PATCH(request: Request, context: LeadRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as LeadPatchPayload;
  const patch: LeadPatch = {};

  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !(LEAD_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: `Status must be one of ${LEAD_STATUSES.join(", ")}.` }, { status: 400 });
    }

    patch.status = body.status as LeadStatus;
  }

  if (body.ownerId !== undefined) {
    const ownerId = optionalText(body.ownerId, 40) ?? null;

    if (
      ownerId &&
      !(await prisma.user.count({ where: { id: ownerId, workspaceId: session.user.workspaceId, isActive: true } }))
    ) {
      return NextResponse.json({ error: "That owner is not an active member of this workspace." }, { status: 400 });
    }

    patch.ownerId = ownerId;
  }

  for (const key of ["name", "company", "intent"] as const) {
    const value = optionalText(body[key], key === "intent" ? 400 : 120);

    if (value !== undefined) {
      patch[key] = value;
    }
  }

  if (body.email !== undefined) {
    const raw = optionalText(body.email, 160);
    const email = raw ? normalizeEmail(raw) : null;

    if (raw && !email) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    patch.email = email;
  }

  if (body.phone !== undefined) {
    const raw = optionalText(body.phone, 32);
    const phone = raw ? normalizePhone(raw) : null;

    if (raw && !phone) {
      return NextResponse.json({ error: "Enter a valid phone number with country code." }, { status: 400 });
    }

    patch.phone = phone;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const lead = await updateLead(session.user.workspaceId, id, patch, session.user.fullName);

  if (!lead) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  if (!lead.email && !lead.phone) {
    return NextResponse.json({ lead, warning: "This lead has no email or phone left, so nobody can follow up." });
  }

  return NextResponse.json({ lead });
}

/** Deletes a lead (privacy request or spam). Manager role or higher. */
export async function DELETE(_request: Request, context: LeadRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const lead = await prisma.lead.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    select: { id: true, email: true, phone: true },
  });

  if (!lead) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  // deleteMany: a second click (or a parallel request) gets 404 instead of an error.
  const result = await prisma.lead.deleteMany({ where: { id, workspaceId: session.user.workspaceId } });

  if (result.count === 0) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  // Connected CRMs are told, so they can delete their copy too (the delivery keeps
  // only the id and contact details needed to find it).
  await enqueueWebhookEvent({
    workspaceId: session.user.workspaceId,
    event: "lead.deleted",
    data: {
      lead: { id: lead.id, email: lead.email, phone: lead.phone },
      deletedBy: session.user.fullName,
      deletedAt: new Date().toISOString(),
    },
  });

  return NextResponse.json({ success: true });
}
