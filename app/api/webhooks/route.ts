import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";
import { MAX_WEBHOOKS_PER_WORKSPACE, loadEndpoints, parseEvents, serializeEndpoint } from "@/src/lib/webhook-admin";
import {
  WEBHOOK_EVENTS,
  generateWebhookSecret,
  storeWebhookSecret,
  validateWebhookUrl,
} from "@/src/lib/webhooks";

/** Outgoing webhooks (Module 8 FE-4). Admin only: they send customer data out. */
export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  return NextResponse.json({
    endpoints: await loadEndpoints(session.user.workspaceId),
    events: WEBHOOK_EVENTS,
  });
}

type EndpointPayload = { name?: unknown; url?: unknown; events?: unknown };

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const body = (await request.json().catch(() => ({}))) as EndpointPayload;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const events = parseEvents(body.events) ?? (body.events === undefined ? ["lead.created", "lead.updated"] : null);

  if (!name) {
    return NextResponse.json({ error: "Give the webhook a name, like \"HubSpot\" or \"Zapier\"." }, { status: 400 });
  }

  if (!events) {
    return NextResponse.json({ error: `Events must be chosen from ${WEBHOOK_EVENTS.join(", ")}.` }, { status: 400 });
  }

  const checked = await validateWebhookUrl(typeof body.url === "string" ? body.url : "");

  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  if ((await prisma.webhookEndpoint.count({ where: { workspaceId: session.user.workspaceId } })) >= MAX_WEBHOOKS_PER_WORKSPACE) {
    return NextResponse.json({ error: `Up to ${MAX_WEBHOOKS_PER_WORKSPACE} webhooks per workspace.` }, { status: 400 });
  }

  const secret = generateWebhookSecret();
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      workspaceId: session.user.workspaceId,
      name,
      url: checked.url,
      secret: storeWebhookSecret(secret),
      events,
    },
  });

  // The signing secret is shown once; afterwards only a preview is available.
  return NextResponse.json({ endpoint: serializeEndpoint(endpoint), secret }, { status: 201 });
}
