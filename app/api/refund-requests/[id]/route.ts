import { NextResponse } from "next/server";
import { requirePermission } from "@/src/lib/access";
import { auditUser } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import { decideRefund, formatMoney, RefundError } from "@/src/lib/refunds";

type RefundRouteContext = { params: Promise<{ id: string }> };

/**
 * Module 2 FE-1: a team member approves or declines a refund request.
 *   { decision: "approve" | "decline", note?: string }
 * Approving a Shopify order refunds it in the store; the customer is told either way.
 */
export async function PATCH(request: Request, context: RefundRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "refunds.approve", request);

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { decision?: unknown; note?: unknown };

  if (body.decision !== "approve" && body.decision !== "decline") {
    return NextResponse.json({ error: 'Choose "approve" or "decline".' }, { status: 400 });
  }

  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
    return NextResponse.json({ error: "The note must be text." }, { status: 400 });
  }

  try {
    const result = await decideRefund({
      workspaceId: session.user.workspaceId,
      id,
      decision: body.decision,
      note: typeof body.note === "string" ? body.note : null,
      actor: { id: session.user.id, fullName: session.user.fullName },
    });
    const { request: refund } = result;

    await auditUser(session.user, {
      action: refund.status === "DECLINED" ? "refund.declined" : refund.status === "FAILED" ? "refund.failed" : "refund.approved",
      category: "data",
      outcome: refund.status === "FAILED" ? "FAILED" : "SUCCESS",
      summary: `${session.user.fullName} ${refund.status === "DECLINED" ? "declined" : "approved"} the refund of ${formatMoney(refund.amount, refund.currency)} for order #${refund.orderNumber}${refund.status === "FAILED" ? " (the store refund failed)" : ""}`,
      targetType: "refund_request",
      targetId: refund.id,
      metadata: { status: refund.status, source: refund.source },
      request,
    });

    return NextResponse.json({
      status: refund.status,
      error: refund.error,
      delivered: result.delivered,
    });
  } catch (error) {
    if (error instanceof RefundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
