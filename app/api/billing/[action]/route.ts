import { NextResponse } from "next/server";
import { requirePermission } from "@/src/lib/access";
import { userActor } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import { BillingError, changePlan, openBillingPortal, setCancelAtPeriodEnd, startCheckout } from "@/src/lib/billing";
import { isInterval, isPlanKey } from "@/src/lib/billing-plans";

type RouteContext = { params: Promise<{ action: string }> };

function originOf(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || new URL(request.url).origin;
}

/**
 * Module 3 actions (Manage the subscription permission):
 * - checkout `{ plan, interval }`: Stripe Checkout (or the dev TEST mode) for a paid plan;
 * - change `{ plan, interval }`: upgrade or downgrade with proration;
 * - cancel `{ cancel }`: cancel at the end of the period, or undo that;
 * - portal: Stripe's customer portal (card, invoices).
 */
export async function POST(request: Request, context: RouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "billing.manage", request);

  if (forbidden) {
    return forbidden;
  }

  const { action } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { plan?: unknown; interval?: unknown; cancel?: unknown };
  const actor = { ...userActor(session.user), id: session.user.id };
  const { workspaceId } = session.user;

  try {
    switch (action) {
      case "checkout":
      case "change": {
        if (!isPlanKey(body.plan) || !isInterval(body.interval ?? "MONTH")) {
          return NextResponse.json({ error: "Choose a plan and monthly or yearly billing." }, { status: 400 });
        }
        const interval = (body.interval ?? "MONTH") as "MONTH" | "YEAR";
        if (action === "checkout") {
          const result = await startCheckout({ workspaceId, plan: body.plan, interval, actor, email: session.user.email ?? null, origin: originOf(request), request });
          return NextResponse.json(result);
        }
        const direction = await changePlan({ workspaceId, plan: body.plan, interval, actor, request });
        return NextResponse.json({ direction });
      }
      case "cancel": {
        if (typeof body.cancel !== "boolean") {
          return NextResponse.json({ error: "Say whether to cancel (true) or keep (false) the plan." }, { status: 400 });
        }
        const subscription = await setCancelAtPeriodEnd({ workspaceId, cancel: body.cancel, actor, request });
        return NextResponse.json({ cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, currentPeriodEnd: subscription.currentPeriodEnd });
      }
      case "portal":
        return NextResponse.json({ url: await openBillingPortal(workspaceId, originOf(request)) });
      default:
        return NextResponse.json({ error: "Unknown billing action." }, { status: 404 });
    }
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
