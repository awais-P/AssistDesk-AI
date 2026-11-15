import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Module 3 with Stripe: Checkout, plan changes, cancellation and the customer portal
 * call a fake Stripe (Stripe can't be reached from a test); webhooks are real signed
 * payloads (Stripe's own test signature) handled by the real route and database.
 */

const WEBHOOK_SECRET = "fake-webhook-secret-for-tests";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

type SignedIn = { user: { id: string; role: string; workspaceId: string; fullName: string; email: string; customRole: null } };
const signedIn: { current: SignedIn | null } = { current: null };

vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

const signer = new Stripe("fake-key-for-tests");
const calls: Array<{ method: string; args: unknown[] }> = [];
const remoteSubscriptions = new Map<string, Record<string, unknown>>();
const record = (method: string, result: (...args: unknown[]) => unknown) => async (...args: unknown[]) => {
  calls.push({ method, args });
  return result(...args);
};

const periodStart = Math.floor(Date.UTC(2026, 10, 16) / 1000);
const periodEnd = Math.floor(Date.UTC(2026, 11, 16) / 1000);

function remoteSubscription(id: string, workspaceId: string, plan: string, status = "active") {
  return {
    id,
    object: "subscription",
    customer: "cus_test_1",
    status,
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    metadata: { workspaceId, plan, interval: "MONTH" },
    items: { data: [{ id: "si_test_1", current_period_start: periodStart, current_period_end: periodEnd, price: { recurring: { interval: "month" } } }] },
  };
}

const fakeStripe = {
  customers: { create: record("customers.create", () => ({ id: "cus_test_1" })) },
  checkout: { sessions: { create: record("checkout.sessions.create", () => ({ id: "cs_test_1", url: "https://checkout.stripe.test/session/cs_test_1" })) } },
  subscriptions: {
    retrieve: record("subscriptions.retrieve", (id) => remoteSubscriptions.get(String(id))),
    update: record("subscriptions.update", (id) => remoteSubscriptions.get(String(id))),
  },
  prices: { create: record("prices.create", () => ({ id: "price_test_new" })) },
  billingPortal: { sessions: { create: record("billingPortal.sessions.create", () => ({ url: "https://billing.stripe.test/portal" })) } },
  webhooks: signer.webhooks,
};

const billing = await import("@/src/lib/billing");
billing.setStripeForTests(fakeStripe as never);
const actionRoute = await import("@/app/api/billing/[action]/route");
const webhookRoute = await import("@/app/api/billing/webhook/route");

const suffix = Date.now().toString(36);
let workspaceId = "";
let adminId = "";
let eventCounter = 0;

const post = (action: string, body: unknown) => actionRoute.POST(new Request(`http://localhost/api/billing/${action}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ action }) });
const subscription = () => prisma.subscription.findUniqueOrThrow({ where: { workspaceId } });

function webhook(type: string, object: unknown, { id, secret = WEBHOOK_SECRET }: { id?: string; secret?: string } = {}) {
  eventCounter += 1;
  const payload = JSON.stringify({ id: id ?? `evt_test_${suffix}_${eventCounter}`, object: "event", type, data: { object } });
  const signature = signer.webhooks.generateTestHeaderString({ payload, secret });
  return webhookRoute.POST(new Request("http://localhost/api/billing/webhook", { method: "POST", headers: { "stripe-signature": signature }, body: payload }));
}

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `Stripe ${suffix}`, slug: `stripe-${suffix}`, supportEmail: `owner-${suffix}@example.com` } })).id;
  adminId = (await prisma.user.create({ data: { workspaceId, fullName: "Amna Admin", username: `stripe-admin-${suffix}`, email: `stripe-${suffix}@example.com`, role: "ADMIN" } })).id;
  signedIn.current = { user: { id: adminId, role: "ADMIN", workspaceId, fullName: "Amna Admin", email: `stripe-${suffix}@example.com`, customRole: null } };
  remoteSubscriptions.set("sub_test_1", remoteSubscription("sub_test_1", workspaceId, "GROWTH"));
});

afterAll(async () => {
  billing.setStripeForTests(null);
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.$disconnect();
});

describe("IT-27 Stripe payments, renewals and invoices - Module 3 FE-2, FE-3, FE-4, FE-5", () => {
  it("IT-27.01 checkout sends the customer to Stripe with the plan's price; no card touches AssistDesk", async () => {
    const response = await post("checkout", { plan: "GROWTH", interval: "MONTH" });
    expect(await response.json()).toMatchObject({ url: "https://checkout.stripe.test/session/cs_test_1", mode: "stripe" });

    const session = calls.find((call) => call.method === "checkout.sessions.create")!.args[0] as Record<string, unknown>;
    expect(session).toMatchObject({
      mode: "subscription",
      customer: "cus_test_1",
      metadata: { workspaceId, plan: "GROWTH", interval: "MONTH" },
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 4900, recurring: { interval: "month" } } }],
    });
    expect(await subscription()).toMatchObject({ status: "INCOMPLETE", customerId: "cus_test_1", provider: "STRIPE" });
  });

  it("IT-27.02 webhooks with a missing or wrong signature are refused", async () => {
    expect((await webhookRoute.POST(new Request("http://localhost", { method: "POST", body: "{}" }))).status).toBe(400);
    expect((await webhook("checkout.session.completed", {}, { secret: "someone-elses-secret" })).status).toBe(400);
  });

  it("IT-27.03 a completed checkout activates the plan with Stripe's billing period, once", async () => {
    const object = { id: "cs_test_1", object: "checkout.session", customer: "cus_test_1", subscription: "sub_test_1", metadata: { workspaceId, plan: "GROWTH" } };
    expect(await (await webhook("checkout.session.completed", object, { id: `evt_checkout_${suffix}` })).json()).toMatchObject({ handled: true });
    expect(await subscription()).toMatchObject({ plan: "GROWTH", interval: "MONTH", status: "ACTIVE", providerSubscriptionId: "sub_test_1" });
    expect((await subscription()).currentPeriodEnd!.getTime()).toBe(periodEnd * 1000);

    expect(await (await webhook("checkout.session.completed", object, { id: `evt_checkout_${suffix}` })).json()).toMatchObject({ handled: false, duplicate: true });
    expect(await prisma.notification.count({ where: { workspaceId, title: "You're on the Growth plan" } })).toBe(1);
  });

  it("IT-27.04 a paid invoice is stored with Stripe's links; a failed renewal is marked and the team alerted", async () => {
    const invoice = (id: string, status: string, paid: number) => ({
      id,
      object: "invoice",
      customer: "cus_test_1",
      number: `AD-${id}`,
      status,
      currency: "usd",
      amount_due: 4900,
      amount_paid: paid,
      hosted_invoice_url: `https://invoice.stripe.test/${id}`,
      invoice_pdf: `https://invoice.stripe.test/${id}.pdf`,
      status_transitions: { paid_at: paid ? periodStart : null },
      lines: { data: [{ period: { start: periodStart, end: periodEnd } }] },
    });
    await webhook("invoice.paid", invoice("in_test_1", "paid", 4900));
    await webhook("invoice.payment_failed", invoice("in_test_2", "open", 0));

    const rows = await prisma.invoice.findMany({ where: { workspaceId }, orderBy: { number: "asc" } });
    expect(rows).toMatchObject([
      { providerInvoiceId: "in_test_1", status: "PAID", amountPaid: 4900, plan: "GROWTH", pdfUrl: "https://invoice.stripe.test/in_test_1.pdf" },
      { providerInvoiceId: "in_test_2", status: "FAILED", amountPaid: 0 },
    ]);
    expect(await prisma.notification.count({ where: { workspaceId, title: "A payment failed" } })).toBe(1);
  });

  it("IT-27.05 while Stripe retries a failed payment the plan stays; a renewal moves the period on", async () => {
    await webhook("customer.subscription.updated", remoteSubscription("sub_test_1", workspaceId, "GROWTH", "past_due"));
    expect(billing.effectivePlan(await subscription())).toMatchObject({ plan: "GROWTH", status: "PAST_DUE" });

    const renewed = remoteSubscription("sub_test_1", workspaceId, "GROWTH", "active");
    (renewed.items.data[0] as Record<string, unknown>).current_period_end = periodEnd + 30 * 86_400;
    await webhook("customer.subscription.updated", renewed);
    expect(await subscription()).toMatchObject({ status: "ACTIVE" });
    expect((await subscription()).currentPeriodEnd!.getTime()).toBe((periodEnd + 30 * 86_400) * 1000);
  });

  it("IT-27.06 an upgrade switches the Stripe subscription to the new price with proration", async () => {
    calls.length = 0;
    expect(await (await post("change", { plan: "BUSINESS", interval: "MONTH" })).json()).toEqual({ direction: "upgrade" });
    expect(calls.find((call) => call.method === "prices.create")!.args[0]).toMatchObject({ unit_amount: 14900, recurring: { interval: "month" } });
    expect(calls.find((call) => call.method === "subscriptions.update")!.args).toEqual([
      "sub_test_1",
      expect.objectContaining({ items: [{ id: "si_test_1", price: "price_test_new" }], proration_behavior: "create_prorations", metadata: { workspaceId, plan: "BUSINESS", interval: "MONTH" } }),
    ]);
    expect((await subscription()).plan).toBe("BUSINESS");
  });

  it("IT-27.07 cancelling tells Stripe to stop at the period end; Stripe's deletion moves the workspace to Free", async () => {
    calls.length = 0;
    await post("cancel", { cancel: true });
    expect(calls.find((call) => call.method === "subscriptions.update")!.args).toEqual(["sub_test_1", { cancel_at_period_end: true }]);
    expect((await subscription()).cancelAtPeriodEnd).toBe(true);

    await webhook("customer.subscription.deleted", remoteSubscription("sub_test_1", workspaceId, "BUSINESS", "canceled"));
    expect(await subscription()).toMatchObject({ plan: "FREE", status: "ACTIVE", providerSubscriptionId: null });
  });

  it("IT-27.08 the customer portal opens Stripe's page for this customer", async () => {
    expect(await (await post("portal", {})).json()).toEqual({ url: "https://billing.stripe.test/portal" });
    expect(calls.find((call) => call.method === "billingPortal.sessions.create")!.args[0]).toMatchObject({ customer: "cus_test_1" });
  });
});
