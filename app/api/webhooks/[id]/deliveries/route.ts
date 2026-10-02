import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";

type WebhookDeliveriesRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const PAGE_SIZE = 20;

/** Delivery log of one webhook (SRS: "log delivery status"), newest first, paginated. */
export async function GET(request: Request, context: WebhookDeliveriesRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const page = Math.max(1, Math.floor(Number(new URL(request.url).searchParams.get("page")) || 1));
  const where = { endpointId: id, workspaceId: session.user.workspaceId };
  const [deliveries, total] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        event: true,
        status: true,
        attempts: true,
        responseStatus: true,
        responseBody: true,
        error: true,
        nextAttemptAt: true,
        deliveredAt: true,
        createdAt: true,
        payload: true,
        lead: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.webhookDelivery.count({ where }),
  ]);

  return NextResponse.json({
    deliveries: deliveries.map((delivery) => ({
      ...delivery,
      nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      createdAt: delivery.createdAt.toISOString(),
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
