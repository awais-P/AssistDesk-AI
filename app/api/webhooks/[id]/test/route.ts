import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { RATE_LIMITS, consumeRateLimit, tooManyRequests } from "@/src/lib/rate-limit";
import { requireRole } from "@/src/lib/rbac";
import { sendTestWebhook } from "@/src/lib/webhooks";

type WebhookTestRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/** "Send test": one signed `webhook.test` request; the receiver's answer is shown. */
export async function POST(_request: Request, context: WebhookTestRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const limit = await consumeRateLimit(`webhook-test:${session.user.id}`, RATE_LIMITS.aiTestPerUser);

  if (!limit.allowed) {
    return tooManyRequests(limit, "Too many test requests.");
  }

  const { id } = await context.params;
  const delivery = await sendTestWebhook(id, session.user.workspaceId);

  if (!delivery) {
    return NextResponse.json({ error: "Webhook not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: delivery.status === "SUCCESS",
    status: delivery.status,
    responseStatus: delivery.responseStatus,
    responseBody: delivery.responseBody,
    error: delivery.error,
  });
}
