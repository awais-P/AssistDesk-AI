import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";
import { MAX_ATTEMPTS, attemptDelivery } from "@/src/lib/webhooks";

type RetryRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/** Manual retry of a failed or waiting delivery: one more signed attempt, right now. */
export async function POST(_request: Request, context: RetryRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const delivery = await prisma.webhookDelivery.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    select: { id: true, status: true, attempts: true, event: true },
  });

  if (!delivery) {
    return NextResponse.json({ error: "Delivery not found." }, { status: 404 });
  }

  if (delivery.status === "SUCCESS") {
    return NextResponse.json({ error: "This delivery already succeeded." }, { status: 409 });
  }

  if (delivery.event === "webhook.test") {
    return NextResponse.json({ error: "Use \"Send test\" to send another test event." }, { status: 400 });
  }

  // Allow exactly one more attempt beyond the automatic ones.
  await prisma.webhookDelivery.update({
    where: { id },
    data: { status: "RETRYING", attempts: Math.min(delivery.attempts, MAX_ATTEMPTS - 1), nextAttemptAt: null },
    select: { id: true },
  });

  const updated = await attemptDelivery(id);

  return NextResponse.json({
    status: updated?.status ?? "RETRYING",
    responseStatus: updated?.responseStatus ?? null,
    error: updated?.error ?? null,
  });
}
