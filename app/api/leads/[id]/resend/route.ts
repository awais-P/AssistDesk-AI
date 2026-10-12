import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { loadLead, recordLeadEvent } from "@/src/lib/leads";
import { requireRole } from "@/src/lib/rbac";
import { enqueueWebhookEvent } from "@/src/lib/webhooks";

type LeadResendRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/** Sends the lead to all active webhooks again (e.g. after fixing the CRM side). */
export async function POST(_request: Request, context: LeadResendRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const lead = await loadLead(session.user.workspaceId, id);

  if (!lead) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const deliveries = await enqueueWebhookEvent({
    workspaceId: session.user.workspaceId,
    event: "lead.updated",
    leadId: id,
    data: {
      lead: {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        company: lead.company,
        fields: lead.fields,
        intent: lead.intent,
        status: lead.status,
        score: lead.score,
        temperature: lead.temperature,
        source: lead.source,
        channel: lead.channel,
        marketingConsent: lead.marketingConsent,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      },
      chatbot: lead.chatbot,
      conversation: lead.session ? { id: lead.session.id, channel: lead.session.channel } : null,
      resent: true,
    },
  });

  if (deliveries.length === 0) {
    return NextResponse.json(
      { error: "No active webhook listens for lead updates. Add one under Leads → Settings." },
      { status: 400 },
    );
  }

  await recordLeadEvent(session.user.workspaceId, id, "WEBHOOK_RESENT", `Sent again to ${deliveries.length} webhook(s).`, {
    actorName: session.user.fullName,
  });

  return NextResponse.json({ queued: deliveries.length });
}
