import { NextResponse } from "next/server";
import { handleStripeEvent, verifyStripeEvent } from "@/src/lib/billing";

export const dynamic = "force-dynamic";

/**
 * Module 3 FE-2/FE-3/FE-5: Stripe webhook. The Stripe-Signature header is verified with
 * STRIPE_WEBHOOK_SECRET over the raw body; events are handled once (idempotent).
 * Point a Stripe webhook endpoint at /api/billing/webhook with the events
 * checkout.session.completed, customer.subscription.*, invoice.paid,
 * invoice.payment_failed and invoice.finalized.
 */
export async function POST(request: Request) {
  const payload = await request.text();
  const event = verifyStripeEvent(payload, request.headers.get("stripe-signature"));

  if (!event) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    console.error("[billing] Webhook failed:", error);
    // A 500 makes Stripe retry the event later.
    return NextResponse.json({ error: "Could not process the event." }, { status: 500 });
  }
}
