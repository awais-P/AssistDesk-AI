import { refundShopifyOrder } from "./connectors";
import { deliverAgentMessageToChannel } from "./integrations/channel-outbound";
import { sendTeamEmail } from "./mailer";
import { createNotification } from "./notifications";
import { prisma } from "./prisma";
import { appendSessionMessage, recordSessionEvent } from "./session-lifecycle";
import { findCustomerOrder } from "./store-orders";

/**
 * Module 2 FE-1: refunds, decided by people. The AI agent only *requests* a refund
 * (after the customer confirms, for the customer's own order, inside the refund window);
 * a team member with `refunds.approve` approves or declines it on the Refunds page.
 * Approving refunds the order in Shopify when it came from the connected store; without
 * a store the request is marked approved and the team pays it out. The customer is told
 * the outcome in the conversation (or by email when it has ended).
 */
export class RefundError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = ["PENDING", "APPROVED", "REFUNDED"] as const;

export function formatMoney(amount: number | null, currency: string | null) {
  if (amount === null) return "the order amount";
  return `${currency ?? ""} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();
}

export async function requestRefund(input: {
  workspaceId: string;
  sessionId: string | null;
  contactId: string | null;
  orderNumber: string;
  reason: string;
  customer: { name: string | null; email: string | null; phone: string | null };
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const orderNumber = input.orderNumber.replace(/[^0-9A-Za-z-]/g, "").slice(0, 20);
  const reason = input.reason.trim().slice(0, 500);

  if (!orderNumber) {
    return { created: false, note: "Ask the customer for their order number." };
  }

  if (!reason) {
    return { created: false, note: "Ask the customer why they want a refund." };
  }

  const settings = await prisma.workspaceSetting.findUnique({ where: { workspaceId: input.workspaceId }, select: { refundWindowDays: true } });
  const windowDays = settings?.refundWindowDays ?? 30;
  const lookup = await findCustomerOrder(input.workspaceId, { orderNumber, email: input.customer.email, phone: input.customer.phone });

  if (!lookup.found && lookup.reason === "needs_verification") {
    return { created: false, note: "Ask for the email or phone number used for the order, then try again." };
  }

  if (!lookup.found && lookup.reason === "not_found") {
    return { created: false, note: "No order with this number matches the customer's details. Ask them to check the number and the email or phone used." };
  }

  if (!lookup.found && !input.customer.email && !input.customer.phone) {
    // No store to check against: the team must be able to reach and verify the customer.
    return { created: false, note: "Ask for the customer's email or phone number so the team can verify the order." };
  }

  const order = lookup.found ? lookup.order : null;

  if (order?.cancelled || order?.financialStatus === "refunded" || order?.financialStatus === "voided") {
    return { created: false, note: `Order #${orderNumber} is ${order.cancelled ? "cancelled" : "already refunded"}, so there is nothing to refund.` };
  }

  if (order && now.getTime() - new Date(order.placedAt).getTime() > windowDays * DAY_MS) {
    return {
      created: false,
      eligible: false,
      note: `Order #${orderNumber} was placed more than ${windowDays} days ago, outside the refund window. Offer to connect the customer with the team.`,
    };
  }

  const existing = await prisma.refundRequest.findFirst({
    where: { workspaceId: input.workspaceId, orderNumber, status: { in: [...OPEN_STATUSES] } },
    select: { id: true, status: true },
  });

  if (existing) {
    return {
      created: false,
      requestId: existing.id,
      status: existing.status,
      note:
        existing.status === "PENDING"
          ? `A refund for order #${orderNumber} was already requested and is waiting for the team.`
          : `The refund for order #${orderNumber} was already approved.`,
    };
  }

  const request = await prisma.refundRequest.create({
    data: {
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      contactId: input.contactId,
      orderNumber,
      source: order?.source ?? "MANUAL",
      externalOrderId: order?.externalId ?? null,
      amount: order?.total ?? null,
      currency: order?.currency ?? null,
      reason,
      customerName: input.customer.name ?? order?.customerName ?? null,
      customerEmail: input.customer.email ?? order?.customerEmail ?? null,
      customerPhone: input.customer.phone,
    },
  });

  await createNotification({
    workspaceId: input.workspaceId,
    type: "REFUND_REQUEST",
    severity: "WARNING",
    title: `Refund requested for order #${orderNumber}`,
    body: `${request.customerName || request.customerEmail || "A customer"}: ${formatMoney(request.amount, request.currency)}. ${reason}`.slice(0, 300),
    link: "/dashboard/refunds",
  });

  if (input.sessionId) {
    await recordSessionEvent({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      contactId: input.contactId,
      type: "REFUND_REQUESTED",
      detail: `Refund of ${formatMoney(request.amount, request.currency)} requested for order #${orderNumber}; waiting for the team.`,
      metadata: { refundRequestId: request.id },
    });
  }

  return {
    created: true,
    requestId: request.id,
    status: "PENDING",
    amount: request.amount,
    currency: request.currency,
    note: "Tell the customer the refund request was sent to the team, who will review it and reply here. Do not promise that it will be approved.",
  };
}

/** Tells the customer the outcome: in the open conversation, or by email. */
async function tellCustomer(
  request: { workspaceId: string; sessionId: string | null; orderNumber: string; customerEmail: string | null },
  authorName: string,
  text: string,
) {
  if (request.sessionId) {
    const session = await prisma.chatSession.findUnique({ where: { id: request.sessionId }, select: { status: true } });

    if (session && session.status !== "CLOSED") {
      await appendSessionMessage({ sessionId: request.sessionId, workspaceId: request.workspaceId, sender: "AGENT", content: text, authorName });
      await deliverAgentMessageToChannel(request.sessionId, text).catch(() => undefined);
      return "conversation";
    }
  }

  if (request.customerEmail) {
    const result = await sendTeamEmail({ to: [request.customerEmail], subject: `Your refund request for order #${request.orderNumber}`, text });
    return result.status === "SENT" ? "email" : "not delivered";
  }

  return "not delivered";
}

export async function decideRefund(input: {
  workspaceId: string;
  id: string;
  decision: "approve" | "decline";
  note: string | null;
  actor: { id: string; fullName: string };
}) {
  const request = await prisma.refundRequest.findFirst({ where: { id: input.id, workspaceId: input.workspaceId } });

  if (!request) {
    throw new RefundError("Refund request not found.", 404);
  }

  if (request.status !== "PENDING" && request.status !== "FAILED") {
    throw new RefundError("This refund request has already been decided.", 409);
  }

  const note = input.note?.trim().slice(0, 500) || null;
  const decided = { decidedById: input.actor.id, decidedByName: input.actor.fullName, decidedAt: new Date(), decisionNote: note };
  const amount = formatMoney(request.amount, request.currency);

  if (input.decision === "decline") {
    const updated = await prisma.refundRequest.update({ where: { id: request.id }, data: { status: "DECLINED", error: null, ...decided } });
    const delivered = await tellCustomer(
      request,
      input.actor.fullName,
      `We reviewed your refund request for order #${request.orderNumber} and are unable to approve it${note ? `: ${note}` : "."} Reply here if you have any questions.`,
    );
    return { request: updated, delivered };
  }

  if (request.source === "SHOPIFY" && request.externalOrderId) {
    try {
      const refund = await refundShopifyOrder(input.workspaceId, request.externalOrderId, `Approved by ${input.actor.fullName}${note ? `: ${note}` : ""}`);
      const updated = await prisma.refundRequest.update({
        where: { id: request.id },
        data: { status: "REFUNDED", externalRefundId: refund.refundId, error: null, ...decided },
      });
      const delivered = await tellCustomer(
        request,
        input.actor.fullName,
        `Good news: your refund of ${amount} for order #${request.orderNumber} has been approved and sent back to your original payment method. It can take 5–10 business days to appear.`,
      );
      return { request: updated, delivered };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = await prisma.refundRequest.update({ where: { id: request.id }, data: { status: "FAILED", error: message.slice(0, 300), ...decided } });
      return { request: updated, delivered: "not sent" };
    }
  }

  // No store to refund through: approved, the team pays it out.
  const updated = await prisma.refundRequest.update({ where: { id: request.id }, data: { status: "APPROVED", error: null, ...decided } });
  const delivered = await tellCustomer(
    request,
    input.actor.fullName,
    `Good news: your refund of ${amount} for order #${request.orderNumber} has been approved. Our team will process the payment and let you know once it has been sent.`,
  );
  return { request: updated, delivered };
}
