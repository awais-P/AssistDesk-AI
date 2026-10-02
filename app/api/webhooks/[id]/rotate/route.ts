import { NextResponse } from "next/server";
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
export async function POST(_request: Request, context: WebhookRotateRouteContext) {
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

  return NextResponse.json({ endpoint: serializeEndpoint(endpoint), secret });
}
