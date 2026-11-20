import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { getCurrentSession } from "@/src/lib/auth";
import { can } from "@/src/lib/permissions";
import { prisma } from "@/src/lib/prisma";
import { hasRole } from "@/src/lib/rbac";

const PAGE_SIZE = 25;
const VIEWS = { pending: ["PENDING", "FAILED"], decided: ["REFUNDED", "APPROVED", "DECLINED"], all: null } as const;

/**
 * Module 2 FE-1: the refund requests the AI collected, for the Refunds page.
 *   ?view=pending|decided|all  &q=order number, name or email  &page=1
 * Every team member can see them; deciding needs `refunds.approve`.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const viewParam = url.searchParams.get("view") ?? "pending";
  const view = (viewParam in VIEWS ? viewParam : "pending") as keyof typeof VIEWS;
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page")) || 1));
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const workspaceId = session.user.workspaceId;
  const statuses = VIEWS[view];

  const where: Prisma.RefundRequestWhereInput = {
    workspaceId,
    ...(statuses ? { status: { in: [...statuses] } } : {}),
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q.replace(/^#/, ""), mode: "insensitive" } },
            { customerName: { contains: q, mode: "insensitive" } },
            { customerEmail: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [requests, total, pendingCount, settings, store] = await Promise.all([
    prisma.refundRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.refundRequest.count({ where }),
    prisma.refundRequest.count({ where: { workspaceId, status: { in: ["PENDING", "FAILED"] } } }),
    prisma.workspaceSetting.findUnique({ where: { workspaceId }, select: { refundWindowDays: true } }),
    prisma.connector.count({ where: { workspaceId, provider: "SHOPIFY", status: "CONNECTED" } }),
  ]);

  return NextResponse.json({
    requests: requests.map((item) => ({
      id: item.id,
      orderNumber: item.orderNumber,
      source: item.source,
      amount: item.amount,
      currency: item.currency,
      reason: item.reason,
      customerName: item.customerName,
      customerEmail: item.customerEmail,
      customerPhone: item.customerPhone,
      status: item.status,
      sessionId: item.sessionId,
      contactId: item.contactId,
      decidedByName: item.decidedByName,
      decidedAt: item.decidedAt?.toISOString() ?? null,
      decisionNote: item.decisionNote,
      error: item.error,
      createdAt: item.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    pendingCount,
    refundWindowDays: settings?.refundWindowDays ?? 30,
    shopifyConnected: store > 0,
    canDecide: can(session.user, "refunds.approve"),
    canEditSettings: hasRole(session.user.role, "ADMIN"),
  });
}
