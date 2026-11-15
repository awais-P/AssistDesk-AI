import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { billingMode, effectivePlan, loadUsage } from "@/src/lib/billing";
import { PLANS, PLAN_BY_KEY } from "@/src/lib/billing-plans";
import { can } from "@/src/lib/permissions";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

/** Module 3: the workspace's plan, usage against its limits, invoices and billing history. */
export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { workspaceId } = session.user;
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId } });
  const effective = effectivePlan(subscription);
  const usage = await loadUsage(workspaceId);
  const invoices = await prisma.invoice.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 24 });
  const events = await prisma.billingEvent.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, type: true, summary: true, createdAt: true, provider: true } });

  return NextResponse.json({
    mode: billingMode(),
    canManage: can(session.user, "billing.manage"),
    plans: PLANS,
    subscription: subscription
      ? {
          plan: subscription.plan,
          interval: subscription.interval,
          status: subscription.status,
          provider: subscription.provider,
          currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
          trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          hasPortal: subscription.provider === "STRIPE" && Boolean(subscription.customerId),
        }
      : null,
    effective,
    limits: effective.plan ? PLAN_BY_KEY.get(effective.plan)!.limits : null,
    usage,
    invoices: invoices.map((invoice) => ({ ...invoice, createdAt: invoice.createdAt.toISOString(), paidAt: invoice.paidAt?.toISOString() ?? null, periodStart: invoice.periodStart?.toISOString() ?? null, periodEnd: invoice.periodEnd?.toISOString() ?? null })),
    events: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  });
}
