"use client";

import { useCallback, useEffect, useState } from "react";
import { type BillingInterval, LIMIT_LABELS, type LimitKey, type PlanDefinition, type PlanKey, formatPrice, planChange, yearlySaving } from "@/src/lib/billing-plans";
import { RelativeTime } from "./notifications-bell";

type BillingData = {
  mode: "stripe" | "test" | "off";
  canManage: boolean;
  plans: PlanDefinition[];
  subscription: {
    plan: string;
    interval: BillingInterval;
    status: string;
    provider: string;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    hasPortal: boolean;
  } | null;
  effective: { plan: PlanKey | null; status: string; trialing: boolean; trialDaysLeft: number | null; limited: boolean };
  limits: Record<LimitKey, number | null> | null;
  usage: Record<LimitKey, number>;
  invoices: Array<{ id: string; number: string; status: string; amountDue: number; amountPaid: number; currency: string; plan: string; interval: string; createdAt: string; hostedUrl: string | null; provider: string }>;
  events: Array<{ id: string; type: string; summary: string | null; createdAt: string }>;
  error?: string;
};

const buttonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-50";
const primaryClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50";
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const percent = limit === null ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const tone = limit !== null && used >= limit ? "bg-red-400" : percent >= 80 ? "bg-amber-300" : "bg-emerald-300";
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="text-white">
          {used.toLocaleString("en-US")} / {limit === null ? "unlimited" : limit.toLocaleString("en-US")}
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-white/10" role="meter" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit ?? used}>
        <div className={`h-2 rounded-full ${tone}`} style={{ width: `${limit === null ? 4 : percent}%` }} />
      </div>
    </div>
  );
}

export function BillingWorkspace({ checkout }: { checkout: string | null }) {
  const [data, setData] = useState<BillingData | null>(null);
  const [interval, setBillingInterval] = useState<BillingInterval>("MONTH");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(checkout === "success" ? "Thank you! Your plan is being activated; this page updates in a moment." : checkout === "cancelled" ? "Checkout was cancelled; nothing was charged." : "");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/billing", { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as BillingData;
    if (!response.ok) {
      setError(body.error ?? "Could not load billing.");
      return;
    }
    setData(body);
    if (body.subscription?.interval) setBillingInterval(body.subscription.interval);
  }, []);

  useEffect(() => {
    void load();
    // Stripe confirms a checkout by webhook a few seconds after the redirect.
    if (checkout === "success") {
      const timer = window.setTimeout(() => void load(), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [load, checkout]);

  async function act(key: string, action: string, body: unknown, success: (result: Record<string, unknown>) => string | null) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/billing/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; url?: string };
      if (!response.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      if (typeof result.url === "string" && !result.url.includes("/dashboard/billing")) {
        window.location.href = result.url;
        return;
      }
      setNotice(success(result) ?? "");
      await load();
    } finally {
      setBusy(null);
    }
  }

  const subscription = data?.subscription;
  const current = data?.effective.plan ?? null;
  const paid = Boolean(subscription && subscription.plan !== "FREE" && ["ACTIVE", "PAST_DUE"].includes(subscription.status));

  return (
    <div className="px-5 py-4 md:px-6">
      <h1 className="heading-font text-[2rem] font-bold leading-none text-white">Billing</h1>
      <p className="mt-3 max-w-3xl text-sm text-slate-400">
        Your plan, what you are using, and your invoices. Payments are handled by Stripe; AssistDesk never sees your card.
      </p>

      {data?.mode === "test" ? (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Test mode: no payment provider is connected on this server, so plan changes are simulated and no money is taken. Set STRIPE_SECRET_KEY to use Stripe.
        </p>
      ) : null}
      {data?.mode === "off" ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-slate-300">Payments are not set up on this server yet.</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      {data ? (
        <div className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <section aria-labelledby="current-plan" className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
            <h2 id="current-plan" className="text-sm uppercase tracking-wide text-slate-400">
              Current plan
            </h2>
            <p className="mt-1 text-2xl font-semibold text-white">
              {current ? data.plans.find((plan) => plan.key === current)?.name : "No plan yet"}
              {data.effective.trialing ? <span className="ml-2 text-base font-normal text-sky-200">trial · {data.effective.trialDaysLeft} day(s) left</span> : null}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              {!subscription
                ? "This workspace was created before plans existed and has no limits until you choose a plan."
                : data.effective.status === "PAST_DUE"
                  ? "A payment failed. Stripe will try again; update your card to avoid losing the plan."
                  : subscription.cancelAtPeriodEnd
                    ? `Cancelled: the plan stays until ${day(subscription.currentPeriodEnd)}, then moves to Free.`
                    : paid
                      ? `Billed ${subscription.interval === "YEAR" ? "yearly" : "monthly"} · renews on ${day(subscription.currentPeriodEnd)}`
                      : data.effective.trialing
                        ? `The trial ends on ${day(subscription.trialEndsAt)}. Choose a plan to keep these limits.`
                        : "The Free plan has no charge."}
            </p>
            {data.canManage && paid ? (
              <div className="mt-4 flex flex-wrap gap-2.5">
                {subscription?.cancelAtPeriodEnd ? (
                  <button type="button" className={primaryClass} disabled={busy !== null} onClick={() => void act("resume", "cancel", { cancel: false }, () => "Your plan will continue.")}>
                    Keep my plan
                  </button>
                ) : (
                  <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void act("cancel", "cancel", { cancel: true }, () => "Cancelled. You keep the plan until the end of the period.")}>
                    Cancel plan
                  </button>
                )}
                {subscription?.hasPortal ? (
                  <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void act("portal", "portal", {}, () => null)}>
                    Payment method and receipts
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section aria-labelledby="usage-title" className="space-y-4 rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
            <h2 id="usage-title" className="text-sm uppercase tracking-wide text-slate-400">
              Usage
            </h2>
            {(Object.keys(LIMIT_LABELS) as LimitKey[]).map((key) => (
              <Meter key={key} label={LIMIT_LABELS[key]} used={data.usage[key]} limit={data.limits ? data.limits[key] : null} />
            ))}
          </section>
        </div>
      ) : null}

      {data ? (
        <section aria-labelledby="plans-title" className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="plans-title" className="text-lg font-semibold text-white">
              Plans
            </h2>
            <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-xl bg-[#1a1a1a] p-1">
              {(["MONTH", "YEAR"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={interval === value}
                  onClick={() => setBillingInterval(value)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${interval === value ? "bg-[#2b2b2b] text-white" : "text-slate-400"}`}
                >
                  {value === "MONTH" ? "Monthly" : "Yearly (2 months free)"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {data.plans.map((plan) => {
              const isCurrent = current === plan.key && (plan.key === "FREE" || subscription?.interval === interval) && !data.effective.trialing;
              const direction = paid && subscription ? planChange(subscription, { plan: plan.key, interval }) : null;
              return (
                <article key={plan.key} aria-label={`${plan.name} plan`} className={`flex flex-col rounded-[22px] border p-5 ${isCurrent ? "border-white/60 bg-white/[0.04]" : "border-white/10 bg-[#0a0a0a]"}`}>
                  <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                  <p className="text-sm text-slate-400">{plan.tagline}</p>
                  <p className="mt-3 text-3xl font-semibold text-white">
                    {formatPrice(plan.price[interval])}
                    <span className="text-sm font-normal text-slate-400">/{interval === "YEAR" ? "year" : "month"}</span>
                  </p>
                  {interval === "YEAR" && yearlySaving(plan) > 0 ? <p className="text-xs text-emerald-300">Save {formatPrice(yearlySaving(plan))} a year</p> : null}
                  <ul className="mt-3 space-y-1 text-sm text-slate-300">
                    <li>{plan.limits.aiReplies?.toLocaleString("en-US")} AI replies a month</li>
                    <li>{plan.limits.agents ?? "Unlimited"} AI agents · {plan.limits.chatbots ?? "unlimited"} chatbots</li>
                    <li>{plan.limits.seats} team members</li>
                    {plan.features.map((feature) => (
                      <li key={feature} className="text-slate-400">
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-4">
                    {isCurrent ? (
                      <span className="text-sm font-semibold text-white">Your plan</span>
                    ) : !data.canManage || plan.key === "FREE" ? null : paid && direction && direction !== "same" ? (
                      <button
                        type="button"
                        className={direction === "upgrade" ? primaryClass : buttonClass}
                        disabled={busy !== null}
                        onClick={() => void act(plan.key, "change", { plan: plan.key, interval }, (result) => `${result.direction === "upgrade" ? "Upgraded" : "Downgraded"} to ${plan.name}. The difference is charged or credited for the rest of the period.`)}
                      >
                        {direction === "upgrade" ? "Upgrade" : "Downgrade"}
                      </button>
                    ) : !paid ? (
                      <button
                        type="button"
                        className={primaryClass}
                        disabled={busy !== null || data.mode === "off"}
                        onClick={() => void act(plan.key, "checkout", { plan: plan.key, interval }, () => `You're on the ${plan.name} plan.`)}
                      >
                        {busy === plan.key ? "Opening..." : `Choose ${plan.name}`}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {data ? (
        <div className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <section aria-labelledby="invoices-title" className="overflow-x-auto rounded-[22px] border border-white/10 bg-[#0a0a0a]">
            <h2 id="invoices-title" className="px-4 pt-4 font-semibold text-white">
              Invoices
            </h2>
            <table className="mt-2 w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white">
                  <th scope="col" className="px-4 py-3 font-semibold">Date</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Number</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Plan</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Amount</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      No invoices yet.
                    </td>
                  </tr>
                ) : null}
                {data.invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-white/10 text-slate-200 last:border-b-0">
                    <td className="px-4 py-2.5">{day(invoice.createdAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{invoice.number}</td>
                    <td className="px-4 py-2.5">
                      {invoice.plan.charAt(0) + invoice.plan.slice(1).toLowerCase()} · {invoice.interval === "YEAR" ? "yearly" : "monthly"}
                    </td>
                    <td className="px-4 py-2.5">{formatPrice(invoice.amountDue, invoice.currency)}</td>
                    <td className="px-4 py-2.5">
                      <span className={invoice.status === "PAID" ? "text-emerald-300" : invoice.status === "FAILED" ? "text-red-300" : "text-amber-200"}>{invoice.status.toLowerCase()}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {data.canManage ? (
                        <a href={`/api/billing/invoices/${invoice.id}`} target="_blank" rel="noreferrer" className="text-xs text-slate-300 underline underline-offset-2">
                          View
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="history-title" className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
            <h2 id="history-title" className="font-semibold text-white">
              Billing history
            </h2>
            {data.events.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nothing yet.</p> : null}
            <ul className="mt-3 space-y-2 text-sm">
              {data.events.map((event) => (
                <li key={event.id} className="flex justify-between gap-3">
                  <span className="text-slate-300">{event.summary ?? event.type}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    <RelativeTime value={event.createdAt} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
