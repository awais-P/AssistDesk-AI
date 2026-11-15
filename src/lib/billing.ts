import Stripe from "stripe";
import type { Prisma, Subscription } from "@/app/generated/prisma/client";
import { type AuditActor, SYSTEM_ACTOR, recordAudit } from "./audit";
import {
  type BillingInterval,
  type LimitKey,
  PLAN_BY_KEY,
  type PlanKey,
  TRIAL_DAYS,
  TRIAL_PLAN,
  downgradeBlockers,
  formatPrice,
  isPlanKey,
  planChange,
} from "./billing-plans";
import { createNotification } from "./notifications";
import { prisma } from "./prisma";

/**
 * Module 3 – Subscription & Payment. Stripe is the payment gateway (FE-2): Checkout
 * takes the card (AssistDesk never sees card details), Stripe renews subscriptions and
 * retries failed payments (FE-3), and signed webhooks keep the subscription and invoice
 * records here in sync (FE-5). Plan changes and cancellation go through the Stripe API
 * with proration (FE-4). Without a Stripe key, development builds use a clearly labelled
 * TEST provider so the flow can be shown; production refuses it.
 */

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ provider

type StripeLike = Pick<Stripe, "checkout" | "subscriptions" | "billingPortal" | "customers" | "webhooks" | "prices">;
let stripeOverride: StripeLike | null = null;
let stripeClient: Stripe | null = null;

/** Tests replace Stripe with a fake (Stripe can't be reached from a test). */
export function setStripeForTests(client: StripeLike | null) {
  stripeOverride = client;
}

export function billingMode(): "stripe" | "test" | "off" {
  if (stripeOverride || process.env.STRIPE_SECRET_KEY?.trim()) return "stripe";
  if (process.env.NODE_ENV !== "production" && process.env.ASSISTDESK_BILLING_TEST_MODE !== "false") return "test";
  return "off";
}

function stripe(): StripeLike {
  if (stripeOverride) return stripeOverride;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new BillingError("Payments are not set up on this server (STRIPE_SECRET_KEY).", 503);
  stripeClient ??= new Stripe(key, { appInfo: { name: "AssistDesk" } });
  return stripeClient;
}

// ------------------------------------------------------------- effective plan

export type EffectivePlan = {
  /** null: the workspace predates billing and is not limited. */
  plan: PlanKey | null;
  status: string;
  trialing: boolean;
  trialDaysLeft: number | null;
  limited: boolean;
};

export function effectivePlan(subscription: Pick<Subscription, "plan" | "status" | "trialEndsAt"> | null, now = new Date()): EffectivePlan {
  if (!subscription) {
    return { plan: null, status: "NONE", trialing: false, trialDaysLeft: null, limited: false };
  }

  const plan = isPlanKey(subscription.plan) ? subscription.plan : "FREE";

  if (subscription.status === "TRIALING") {
    const ends = subscription.trialEndsAt;
    if (ends && ends > now) {
      return { plan, status: "TRIALING", trialing: true, trialDaysLeft: Math.max(1, Math.ceil((ends.getTime() - now.getTime()) / 86_400_000)), limited: true };
    }
    return { plan: "FREE", status: "TRIAL_ENDED", trialing: false, trialDaysLeft: 0, limited: true };
  }

  // A failed renewal keeps the paid plan while Stripe retries the payment.
  if (subscription.status === "ACTIVE" || subscription.status === "PAST_DUE") {
    return { plan, status: subscription.status, trialing: false, trialDaysLeft: null, limited: true };
  }

  return { plan: "FREE", status: subscription.status, trialing: false, trialDaysLeft: null, limited: true };
}

export async function loadPlan(workspaceId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId } });
  return { subscription, effective: effectivePlan(subscription) };
}

// ----------------------------------------------------------------- usage

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const counters: Record<LimitKey, (workspaceId: string) => Promise<number>> = {
  aiReplies: (workspaceId) => prisma.aiInteraction.count({ where: { workspaceId, createdAt: { gte: monthStart() } } }),
  agents: (workspaceId) => prisma.aIAgent.count({ where: { workspaceId } }),
  chatbots: (workspaceId) => prisma.chatbot.count({ where: { workspaceId } }),
  seats: (workspaceId) => prisma.user.count({ where: { workspaceId, isActive: true } }),
  knowledgeSources: (workspaceId) => prisma.knowledgeSource.count({ where: { workspaceId } }),
};

export async function loadUsage(workspaceId: string) {
  const keys = Object.keys(counters) as LimitKey[];
  const values: number[] = [];
  // Sequential: cheap counts, and kind to the PGlite test database.
  for (const key of keys) values.push(await counters[key](workspaceId));
  return Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<LimitKey, number>;
}

/**
 * Whether one more of `key` fits the workspace's plan (Module 3 FE-1). Workspaces that
 * predate billing are not limited.
 */
export async function checkLimit(workspaceId: string, key: LimitKey, adding = 1) {
  const { effective } = await loadPlan(workspaceId);

  if (!effective.limited || !effective.plan) {
    return { allowed: true as const, limit: null, used: null, plan: effective.plan };
  }

  const limit = PLAN_BY_KEY.get(effective.plan)!.limits[key];

  if (limit === null) {
    return { allowed: true as const, limit: null, used: null, plan: effective.plan };
  }

  const used = await counters[key](workspaceId);
  return { allowed: used + adding <= limit, limit, used, plan: effective.plan };
}

/** The message shown when a limit stops an action. */
export function limitMessage(key: LimitKey, check: { limit: number | null; plan: PlanKey | null }) {
  const plan = check.plan ? PLAN_BY_KEY.get(check.plan)!.name : "your";
  const what: Record<LimitKey, string> = {
    aiReplies: "AI replies this month",
    agents: "AI agents",
    chatbots: "chatbots",
    seats: "team members",
    knowledgeSources: "knowledge sources",
  };
  return `The ${plan} plan includes ${check.limit} ${what[key]}. Upgrade in Settings → Billing to add more.`;
}

/**
 * Whether the AI may answer one more message this month. When the plan's AI replies are
 * used up the team is told (once a day) and people answer instead.
 */
export async function aiReplyAllowed(workspaceId: string) {
  const check = await checkLimit(workspaceId, "aiReplies");

  if (!check.allowed) {
    await createNotification({
      workspaceId,
      type: "BILLING",
      severity: "WARNING",
      title: "AI replies for this month are used up",
      body: `${limitMessage("aiReplies", check)} Until then your team answers customers.`,
      link: "/dashboard/billing",
      dedupeMinutes: 24 * 60,
    });
  }

  return check.allowed;
}

export const AI_LIMIT_NOTICE = "Our assistant can't reply right now. A member of our team will get back to you here shortly.";

// ------------------------------------------------------------------- trial

export async function startTrial(workspaceId: string, now = new Date()) {
  return prisma.subscription.upsert({
    where: { workspaceId },
    create: { workspaceId, plan: TRIAL_PLAN, status: "TRIALING", provider: "TEST", trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000) },
    update: {},
  });
}

// ---------------------------------------------------------------- checkout

type Actor = AuditActor & { id: string };

async function logBilling(workspaceId: string, actor: AuditActor, action: string, summary: string, request?: Request | null, metadata?: Prisma.InputJsonValue) {
  await recordAudit({ workspaceId, actor, action, category: "settings", summary, metadata, request });
}

async function ensureCustomer(workspaceId: string, email: string | null) {
  const existing = await prisma.subscription.findUnique({ where: { workspaceId }, select: { customerId: true, provider: true } });
  if (existing?.customerId && existing.provider === "STRIPE") return existing.customerId;
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true, supportEmail: true } });
  const customer = await stripe().customers.create({ name: workspace.name, email: email ?? workspace.supportEmail ?? undefined, metadata: { workspaceId } });
  return customer.id;
}

function priceData(plan: PlanKey, interval: BillingInterval) {
  const definition = PLAN_BY_KEY.get(plan)!;
  return {
    currency: "usd",
    unit_amount: definition.price[interval],
    recurring: { interval: interval === "YEAR" ? ("year" as const) : ("month" as const) },
    product_data: { name: `AssistDesk ${definition.name}`, metadata: { plan } },
  };
}

/**
 * Starts paying for a plan. With Stripe: a hosted Checkout page (the card never touches
 * AssistDesk). In TEST mode: the plan is activated and a test invoice is written.
 */
export async function startCheckout(input: { workspaceId: string; plan: PlanKey; interval: BillingInterval; actor: Actor; email: string | null; origin: string; request?: Request | null }) {
  if (input.plan === "FREE") {
    throw new BillingError("The Free plan needs no payment. To move to Free, cancel your plan.");
  }

  const mode = billingMode();

  if (mode === "off") {
    throw new BillingError("Payments are not set up on this server yet.", 503);
  }

  if (mode === "test") {
    await activateTestPlan(input.workspaceId, input.plan, input.interval, input.actor, input.request);
    return { url: `${input.origin}/dashboard/billing?checkout=success`, mode };
  }

  const customer = await ensureCustomer(input.workspaceId, input.email);
  await prisma.subscription.upsert({
    where: { workspaceId: input.workspaceId },
    create: { workspaceId: input.workspaceId, plan: "FREE", status: "INCOMPLETE", provider: "STRIPE", customerId: customer },
    update: { customerId: customer },
  });
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price_data: priceData(input.plan, input.interval), quantity: 1 }],
    client_reference_id: input.workspaceId,
    metadata: { workspaceId: input.workspaceId, plan: input.plan, interval: input.interval },
    subscription_data: { metadata: { workspaceId: input.workspaceId, plan: input.plan, interval: input.interval } },
    success_url: `${input.origin}/dashboard/billing?checkout=success`,
    cancel_url: `${input.origin}/dashboard/billing?checkout=cancelled`,
    allow_promotion_codes: true,
  });
  await logBilling(input.workspaceId, input.actor, "billing.checkout_started", `${input.actor.name} started checkout for ${PLAN_BY_KEY.get(input.plan)!.name} (${input.interval.toLowerCase()}ly)`, input.request);
  return { url: session.url ?? `${input.origin}/dashboard/billing`, mode };
}

// ------------------------------------------------------------ change / cancel

export async function changePlan(input: { workspaceId: string; plan: PlanKey; interval: BillingInterval; actor: Actor; request?: Request | null }) {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId: input.workspaceId } });
  const paid = subscription && (subscription.status === "ACTIVE" || subscription.status === "PAST_DUE") && subscription.plan !== "FREE";

  if (!paid) {
    throw new BillingError("Choose a paid plan first (checkout).", 409);
  }

  if (input.plan === "FREE") {
    throw new BillingError("To move to Free, cancel the plan: it stays active until the end of the paid period.");
  }

  const direction = planChange(subscription, { plan: input.plan, interval: input.interval });

  if (direction === "same") {
    throw new BillingError("You are already on this plan.");
  }

  if (direction === "downgrade") {
    const usage = await loadUsage(input.workspaceId);
    const blockers = downgradeBlockers(usage, input.plan);
    if (blockers.length > 0) {
      throw new BillingError(`Too much in use for ${PLAN_BY_KEY.get(input.plan)!.name}: ${blockers.map((item) => `${item.label} ${item.used}/${item.limit}`).join(", ")}. Remove some first.`, 409);
    }
  }

  if (subscription.provider === "STRIPE" && subscription.providerSubscriptionId) {
    const remote = await stripe().subscriptions.retrieve(subscription.providerSubscriptionId);
    const itemId = remote.items.data[0]?.id;
    if (!itemId) throw new BillingError("The subscription has no billable item at Stripe.", 502);
    // A subscription item can only switch to an existing price, so create it first.
    const price = await stripe().prices.create({ ...priceData(input.plan, input.interval), metadata: { plan: input.plan } });
    await stripe().subscriptions.update(subscription.providerSubscriptionId, {
      items: [{ id: itemId, price: price.id }],
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
      metadata: { workspaceId: input.workspaceId, plan: input.plan, interval: input.interval },
    });
    // The webhook (customer.subscription.updated) writes the result; record the intent now.
    await prisma.subscription.update({ where: { id: subscription.id }, data: { plan: input.plan, interval: input.interval, cancelAtPeriodEnd: false } });
  } else {
    await activateTestPlan(input.workspaceId, input.plan, input.interval, input.actor, input.request, { change: true });
  }

  await logBilling(
    input.workspaceId,
    input.actor,
    `billing.${direction}`,
    `${input.actor.name} ${direction === "upgrade" ? "upgraded" : "downgraded"} to ${PLAN_BY_KEY.get(input.plan)!.name} (${input.interval.toLowerCase()}ly)`,
    input.request,
    { from: { plan: subscription.plan, interval: subscription.interval }, to: { plan: input.plan, interval: input.interval } },
  );
  return direction;
}

export async function setCancelAtPeriodEnd(input: { workspaceId: string; cancel: boolean; actor: Actor; request?: Request | null }) {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId: input.workspaceId } });

  if (!subscription || subscription.plan === "FREE" || !["ACTIVE", "PAST_DUE"].includes(subscription.status)) {
    throw new BillingError("There is no paid plan to cancel.", 409);
  }

  if (subscription.provider === "STRIPE" && subscription.providerSubscriptionId) {
    await stripe().subscriptions.update(subscription.providerSubscriptionId, { cancel_at_period_end: input.cancel });
  }

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: { cancelAtPeriodEnd: input.cancel, canceledAt: input.cancel ? new Date() : null },
  });
  await logBilling(
    input.workspaceId,
    input.actor,
    input.cancel ? "billing.cancel_scheduled" : "billing.cancel_undone",
    input.cancel
      ? `${input.actor.name} cancelled the plan; it ends on ${updated.currentPeriodEnd?.toISOString().slice(0, 10) ?? "the end of the period"}`
      : `${input.actor.name} kept the plan (cancellation undone)`,
    input.request,
  );
  return updated;
}

/** Stripe's customer portal: change the card, download invoices, cancel. */
export async function openBillingPortal(workspaceId: string, origin: string) {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId }, select: { customerId: true, provider: true } });

  if (subscription?.provider !== "STRIPE" || !subscription.customerId) {
    throw new BillingError("There is no Stripe customer for this workspace yet.", 409);
  }

  const session = await stripe().billingPortal.sessions.create({ customer: subscription.customerId, return_url: `${origin}/dashboard/billing` });
  return session.url;
}

// ------------------------------------------------------------------ TEST mode

async function nextTestInvoiceNumber(workspaceId: string) {
  const count = await prisma.invoice.count({ where: { workspaceId, provider: "TEST" } });
  return `TEST-${String(count + 1).padStart(4, "0")}`;
}

function addInterval(date: Date, interval: BillingInterval) {
  const next = new Date(date);
  if (interval === "YEAR") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

async function writeTestInvoice(subscription: Subscription, plan: PlanKey, interval: BillingInterval, start: Date, end: Date, amount: number) {
  return prisma.invoice.create({
    data: {
      workspaceId: subscription.workspaceId,
      subscriptionId: subscription.id,
      number: await nextTestInvoiceNumber(subscription.workspaceId),
      provider: "TEST",
      status: "PAID",
      currency: "usd",
      amountDue: amount,
      amountPaid: amount,
      plan,
      interval,
      periodStart: start,
      periodEnd: end,
      paidAt: new Date(),
    },
  });
}

/** TEST mode only: activates or changes a plan and records a (test) paid invoice. */
async function activateTestPlan(workspaceId: string, plan: PlanKey, interval: BillingInterval, actor: AuditActor, request?: Request | null, { change = false } = {}) {
  if (billingMode() !== "test") {
    throw new BillingError("Test billing is only available in development.", 503);
  }

  const now = new Date();
  const existing = await prisma.subscription.findUnique({ where: { workspaceId } });
  const periodEnd = change && existing?.currentPeriodEnd && existing.interval === interval ? existing.currentPeriodEnd : addInterval(now, interval);
  const subscription = await prisma.subscription.upsert({
    where: { workspaceId },
    create: { workspaceId, plan, interval, status: "ACTIVE", provider: "TEST", currentPeriodStart: now, currentPeriodEnd: periodEnd },
    update: { plan, interval, status: "ACTIVE", provider: "TEST", currentPeriodStart: change && existing?.currentPeriodStart ? existing.currentPeriodStart : now, currentPeriodEnd: periodEnd, trialEndsAt: null, cancelAtPeriodEnd: false, canceledAt: null },
  });
  const price = PLAN_BY_KEY.get(plan)!.price[interval];
  // A plan change charges the difference for the rest of the period (proration).
  let amount = price;
  if (change && existing && isPlanKey(existing.plan) && existing.interval === interval && existing.currentPeriodStart && existing.currentPeriodEnd) {
    const total = existing.currentPeriodEnd.getTime() - existing.currentPeriodStart.getTime();
    const left = Math.max(0, existing.currentPeriodEnd.getTime() - now.getTime());
    amount = Math.round(((price - PLAN_BY_KEY.get(existing.plan)!.price[interval]) * left) / Math.max(1, total));
  }
  if (amount > 0) {
    await writeTestInvoice(subscription, plan, interval, now, periodEnd, amount);
  }
  await recordEvent("TEST", `test_${subscription.id}_${now.getTime()}`, change ? "subscription.changed" : "subscription.activated", workspaceId, `${PLAN_BY_KEY.get(plan)!.name} (${interval.toLowerCase()}ly), test mode`);
  if (!change) {
    await logBilling(workspaceId, actor, "billing.subscribed", `${actor.name} subscribed to ${PLAN_BY_KEY.get(plan)!.name} (${interval.toLowerCase()}ly) in test mode`, request);
  }
  return subscription;
}

/**
 * FE-3 renewals that AssistDesk itself runs: trials that ended move to Free, and TEST
 * subscriptions renew (or end when cancelled). Stripe renews real subscriptions itself
 * and tells us through webhooks. Runs hourly in the server and from /api/cron/sessions.
 */
export async function runBillingMaintenance(now = new Date()) {
  let trialsEnded = 0;
  let renewed = 0;
  let ended = 0;

  const trials = await prisma.subscription.findMany({ where: { status: "TRIALING", providerSubscriptionId: null, trialEndsAt: { lte: now } }, take: 200 });
  for (const trial of trials) {
    await prisma.subscription.update({ where: { id: trial.id }, data: { plan: "FREE", status: "ACTIVE", trialEndsAt: trial.trialEndsAt } });
    await recordEvent("TEST", `trial_end_${trial.id}`, "trial.ended", trial.workspaceId, "The free trial ended; the workspace is on the Free plan.");
    await createNotification({
      workspaceId: trial.workspaceId,
      type: "BILLING",
      severity: "WARNING",
      title: "Your free trial has ended",
      body: "The workspace is on the Free plan now. Choose a plan to keep your limits.",
      link: "/dashboard/billing",
    });
    trialsEnded += 1;
  }

  const due = await prisma.subscription.findMany({ where: { provider: "TEST", status: "ACTIVE", plan: { not: "FREE" }, currentPeriodEnd: { lte: now } }, take: 200 });
  for (const subscription of due) {
    if (subscription.cancelAtPeriodEnd) {
      await prisma.subscription.update({ where: { id: subscription.id }, data: { plan: "FREE", status: "ACTIVE", cancelAtPeriodEnd: false } });
      await recordEvent("TEST", `end_${subscription.id}_${subscription.currentPeriodEnd!.getTime()}`, "subscription.ended", subscription.workspaceId, "The cancelled plan ended; the workspace is on the Free plan.");
      ended += 1;
      continue;
    }
    const plan = subscription.plan as PlanKey;
    const interval = subscription.interval as BillingInterval;
    const start = subscription.currentPeriodEnd!;
    const end = addInterval(start, interval);
    const updated = await prisma.subscription.update({ where: { id: subscription.id }, data: { currentPeriodStart: start, currentPeriodEnd: end } });
    await writeTestInvoice(updated, plan, interval, start, end, PLAN_BY_KEY.get(plan)!.price[interval]);
    await recordEvent("TEST", `renew_${subscription.id}_${start.getTime()}`, "subscription.renewed", subscription.workspaceId, `${PLAN_BY_KEY.get(plan)!.name} renewed until ${end.toISOString().slice(0, 10)} (test mode)`);
    renewed += 1;
  }

  return { trialsEnded, renewed, ended };
}

declare global {
  var assistdeskBillingTimer: ReturnType<typeof setInterval> | undefined;
}

export function startBillingMaintenance() {
  if (globalThis.assistdeskBillingTimer || process.env.ASSISTDESK_BILLING_MAINTENANCE === "false") return;
  globalThis.assistdeskBillingTimer = setInterval(() => {
    void runBillingMaintenance().catch((error) => console.error("[billing] Maintenance failed:", error));
  }, 60 * 60 * 1000);
}

// -------------------------------------------------------------- Stripe webhooks

async function recordEvent(provider: string, eventId: string, type: string, workspaceId: string | null, summary: string) {
  try {
    await prisma.billingEvent.create({ data: { provider, eventId, type, workspaceId, summary: summary.slice(0, 300) } });
    return true;
  } catch {
    return false;
  }
}

type Loose = Record<string, unknown>;
const field = (value: unknown, ...path: string[]): unknown => path.reduce<unknown>((current, key) => (current && typeof current === "object" ? (current as Loose)[key] : undefined), value);
const idOf = (value: unknown) => (typeof value === "string" ? value : typeof field(value, "id") === "string" ? (field(value, "id") as string) : null);
const dateOf = (value: unknown) => (typeof value === "number" ? new Date(value * 1000) : null);

const statusMap: Record<string, Subscription["status"]> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  unpaid: "PAST_DUE",
  canceled: "CANCELED",
  incomplete_expired: "CANCELED",
  incomplete: "INCOMPLETE",
  paused: "PAST_DUE",
};

async function workspaceFor(object: unknown) {
  const fromMetadata = field(object, "metadata", "workspaceId");
  if (typeof fromMetadata === "string") return fromMetadata;
  const customer = idOf(field(object, "customer"));
  if (!customer) return null;
  const row = await prisma.subscription.findFirst({ where: { customerId: customer }, select: { workspaceId: true } });
  return row?.workspaceId ?? null;
}

/** Writes a Stripe subscription object to our Subscription row. */
export async function syncStripeSubscription(remote: unknown) {
  const workspaceId = await workspaceFor(remote);
  if (!workspaceId) return null;

  const item = field(remote, "items", "data") as unknown[] | undefined;
  const first = item?.[0];
  const planFromMeta = field(remote, "metadata", "plan") ?? field(first, "price", "product_data", "metadata", "plan");
  const recurring = field(first, "price", "recurring", "interval");
  const plan = isPlanKey(planFromMeta) ? planFromMeta : "STARTER";
  const status = statusMap[String(field(remote, "status"))] ?? "INCOMPLETE";
  // Newer Stripe API versions keep the billing period on the subscription item.
  const periodStart = dateOf(field(first, "current_period_start")) ?? dateOf(field(remote, "current_period_start"));
  const periodEnd = dateOf(field(first, "current_period_end")) ?? dateOf(field(remote, "current_period_end"));

  const data = {
    plan: status === "CANCELED" ? "FREE" : plan,
    interval: recurring === "year" ? "YEAR" : "MONTH",
    status: status === "CANCELED" ? ("ACTIVE" as const) : status,
    provider: "STRIPE",
    customerId: idOf(field(remote, "customer")),
    providerSubscriptionId: status === "CANCELED" ? null : idOf(remote),
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    trialEndsAt: dateOf(field(remote, "trial_end")),
    cancelAtPeriodEnd: Boolean(field(remote, "cancel_at_period_end")),
    canceledAt: dateOf(field(remote, "canceled_at")),
  };

  return prisma.subscription.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
}

const invoiceStatus: Record<string, string> = { paid: "PAID", open: "OPEN", void: "VOID", uncollectible: "FAILED", draft: "OPEN" };

export async function syncStripeInvoice(remote: unknown, { failed = false } = {}) {
  const workspaceId = await workspaceFor(remote);
  const providerInvoiceId = idOf(remote);
  if (!workspaceId || !providerInvoiceId) return null;

  const subscription = await prisma.subscription.findUnique({ where: { workspaceId }, select: { id: true, plan: true, interval: true } });
  const line = (field(remote, "lines", "data") as unknown[] | undefined)?.[0];
  const data = {
    workspaceId,
    subscriptionId: subscription?.id ?? null,
    number: String(field(remote, "number") ?? providerInvoiceId),
    provider: "STRIPE",
    status: failed ? "FAILED" : (invoiceStatus[String(field(remote, "status"))] ?? "OPEN"),
    currency: String(field(remote, "currency") ?? "usd"),
    amountDue: Number(field(remote, "amount_due") ?? 0),
    amountPaid: Number(field(remote, "amount_paid") ?? 0),
    plan: subscription?.plan ?? "STARTER",
    interval: subscription?.interval ?? "MONTH",
    periodStart: dateOf(field(line, "period", "start")) ?? dateOf(field(remote, "period_start")),
    periodEnd: dateOf(field(line, "period", "end")) ?? dateOf(field(remote, "period_end")),
    hostedUrl: (field(remote, "hosted_invoice_url") as string | null) ?? null,
    pdfUrl: (field(remote, "invoice_pdf") as string | null) ?? null,
    paidAt: dateOf(field(remote, "status_transitions", "paid_at")),
  };

  return prisma.invoice.upsert({ where: { providerInvoiceId }, create: { ...data, providerInvoiceId }, update: data });
}

/** Handles one verified Stripe event once (idempotent by event id). */
export async function handleStripeEvent(event: { id: string; type: string; data: { object: unknown } }) {
  const object = event.data.object;
  const workspaceId = await workspaceFor(object);

  if (!(await recordEvent("STRIPE", event.id, event.type, workspaceId, event.type))) {
    return { handled: false, duplicate: true };
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const subscriptionId = idOf(field(object, "subscription"));
      if (subscriptionId) {
        const remote = await stripe().subscriptions.retrieve(subscriptionId);
        const synced = await syncStripeSubscription(remote);
        if (synced) {
          await logBilling(synced.workspaceId, SYSTEM_ACTOR, "billing.subscribed", `Payment received: ${PLAN_BY_KEY.get(synced.plan as PlanKey)?.name ?? synced.plan} (${synced.interval.toLowerCase()}ly)`);
          await createNotification({ workspaceId: synced.workspaceId, type: "BILLING", severity: "SUCCESS", title: `You're on the ${PLAN_BY_KEY.get(synced.plan as PlanKey)?.name ?? synced.plan} plan`, body: "Thanks! Your payment went through.", link: "/dashboard/billing" });
        }
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncStripeSubscription(object);
      break;
    case "invoice.paid":
    case "invoice.payment_succeeded":
    case "invoice.finalized":
      await syncStripeInvoice(object);
      break;
    case "invoice.payment_failed": {
      const invoice = await syncStripeInvoice(object, { failed: true });
      if (invoice) {
        await createNotification({
          workspaceId: invoice.workspaceId,
          type: "BILLING",
          severity: "ERROR",
          title: "A payment failed",
          body: `${formatPrice(invoice.amountDue, invoice.currency)} could not be charged. Update the card in Settings → Billing; Stripe will try again.`,
          link: "/dashboard/billing",
          dedupeMinutes: 60,
        });
      }
      break;
    }
    default:
      return { handled: false, duplicate: false };
  }

  return { handled: true, duplicate: false };
}

/** Verifies the Stripe-Signature header and returns the event, or null. */
export function verifyStripeEvent(payload: string, signature: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !signature) return null;
  try {
    return stripe().webhooks.constructEvent(payload, signature, secret) as unknown as { id: string; type: string; data: { object: unknown } };
  } catch {
    return null;
  }
}
