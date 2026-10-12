import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";
import { loadEndpoint, parseEvents, serializeEndpoint } from "@/src/lib/webhook-admin";
import { WEBHOOK_EVENTS, validateWebhookUrl } from "@/src/lib/webhooks";

type WebhookRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function authorize() {
  const session = await getCurrentSession();

  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }

  const forbidden = requireRole(session.user, "ADMIN");
  return forbidden ? { error: forbidden } : { session };
}

type EndpointPatch = { name?: unknown; url?: unknown; events?: unknown; isActive?: unknown };

export async function PATCH(request: Request, context: WebhookRouteContext) {
  const auth = await authorize();

  if (auth.error) {
    return auth.error;
  }

  const { id } = await context.params;
  const existing = await loadEndpoint(auth.session.user.workspaceId, id);

  if (!existing) {
    return NextResponse.json({ error: "Webhook not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as EndpointPatch;
  const data: { name?: string; url?: string; events?: string[]; isActive?: boolean } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";

    if (!name) {
      return NextResponse.json({ error: "The name cannot be empty." }, { status: 400 });
    }

    data.name = name;
  }

  if (body.url !== undefined) {
    const checked = await validateWebhookUrl(typeof body.url === "string" ? body.url : "");

    if (!checked.ok) {
      return NextResponse.json({ error: checked.error }, { status: 400 });
    }

    data.url = checked.url;
  }

  if (body.events !== undefined) {
    const events = parseEvents(body.events);

    if (!events) {
      return NextResponse.json({ error: `Events must be chosen from ${WEBHOOK_EVENTS.join(", ")}.` }, { status: 400 });
    }

    data.events = events;
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be true or false." }, { status: 400 });
    }

    data.isActive = body.isActive;
  }

  const endpoint = await prisma.webhookEndpoint.update({ where: { id }, data });
  return NextResponse.json({ endpoint: serializeEndpoint(endpoint) });
}

export async function DELETE(_request: Request, context: WebhookRouteContext) {
  const auth = await authorize();

  if (auth.error) {
    return auth.error;
  }

  const { id } = await context.params;
  const result = await prisma.webhookEndpoint.deleteMany({ where: { id, workspaceId: auth.session.user.workspaceId } });

  if (result.count === 0) {
    return NextResponse.json({ error: "Webhook not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
