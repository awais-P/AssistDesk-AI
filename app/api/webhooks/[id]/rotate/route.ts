import { NextResponse } from "next/server";
import { auditUser } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";
import { serializeEndpoint } from "@/src/lib/webhook-admin";
import { generateWebhookSecret, storeWebhookSecret } from "@/src/lib/webhooks";

type WebhookRotateRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/** Issues a new signing secret (shown once). The old one stops working immediately. */
export async function POST(request: Request, context: WebhookRotateRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const existing = await prisma.webhookEndpoint.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Webhook not found." }, { status: 404 });
  }

  const secret = generateWebhookSecret();
  const endpoint = await prisma.webhookEndpoint.update({
    where: { id },
    data: { secret: storeWebhookSecret(secret) },
  });

  await auditUser(session.user, {
    action: "webhook.secret_rotated",
    category: "integrations",
    summary: `${session.user.fullName} rotated the signing secret of webhook "${endpoint.name}"`,
    targetType: "webhook",
    targetId: id,
    request,
  });

  return NextResponse.json({ endpoint: serializeEndpoint(endpoint), secret });
}
