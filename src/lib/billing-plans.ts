/**
 * Module 3 FE-1: the subscription plans and what each includes. Pure data and rules,
 * safe to import in the browser. Prices are in US cents; `null` means unlimited.
 */

export type PlanKey = "FREE" | "STARTER" | "GROWTH" | "BUSINESS";
export type BillingInterval = "MONTH" | "YEAR";
export type LimitKey = "aiReplies" | "agents" | "chatbots" | "seats" | "knowledgeSources";

export type PlanDefinition = {
  key: PlanKey;
  name: string;
  tagline: string;
  /** Price per month when billed monthly, and per year when billed yearly (US cents). */
  price: { MONTH: number; YEAR: number };
  limits: Record<LimitKey, number | null>;
  features: string[];
};

export const PLANS: PlanDefinition[] = [
  {
    key: "FREE",
    name: "Free",
    tagline: "Try AssistDesk on your website",
    price: { MONTH: 0, YEAR: 0 },
    limits: { aiReplies: 100, agents: 1, chatbots: 1, seats: 2, knowledgeSources: 5 },
    features: ["Website chat widget", "Knowledge base (5 sources)", "Tickets and email"],
  },
  {
    key: "STARTER",
    name: "Starter",
    tagline: "For a small team answering every day",
    price: { MONTH: 1900, YEAR: 19000 },
    limits: { aiReplies: 1000, agents: 2, chatbots: 2, seats: 3, knowledgeSources: 25 },
    features: ["Everything in Free", "WhatsApp, Slack and email channels", "AI actions and appointments", "Lead capture and webhooks"],
  },
  {
    key: "GROWTH",
    name: "Growth",
    tagline: "For growing support and sales teams",
    price: { MONTH: 4900, YEAR: 49000 },
    limits: { aiReplies: 5000, agents: 5, chatbots: 5, seats: 10, knowledgeSources: 100 },
    features: ["Everything in Starter", "Escalation queue with SLA", "Analytics and reports", "Public API and connectors"],
  },
  {
    key: "BUSINESS",
    name: "Business",
    tagline: "For high volume and many brands",
    price: { MONTH: 14900, YEAR: 149000 },
    limits: { aiReplies: 25000, agents: null, chatbots: null, seats: 50, knowledgeSources: null },
    features: ["Everything in Growth", "Unlimited agents, chatbots and sources", "Custom roles and audit log", "Priority support"],
  },
];

export const PLAN_BY_KEY = new Map(PLANS.map((plan) => [plan.key, plan]));
export const PLAN_KEYS = PLANS.map((plan) => plan.key);
export const PAID_PLAN_KEYS: PlanKey[] = ["STARTER", "GROWTH", "BUSINESS"];
export const TRIAL_PLAN: PlanKey = "GROWTH";
export const TRIAL_DAYS = 14;

export const LIMIT_LABELS: Record<LimitKey, string> = {
  aiReplies: "AI replies this month",
  agents: "AI agents",
  chatbots: "Chatbots",
  seats: "Team members",
  knowledgeSources: "Knowledge sources",
};

const rank: Record<PlanKey, number> = { FREE: 0, STARTER: 1, GROWTH: 2, BUSINESS: 3 };

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && PLAN_KEYS.includes(value as PlanKey);
}

export function isInterval(value: unknown): value is BillingInterval {
  return value === "MONTH" || value === "YEAR";
}

/** "upgrade", "downgrade" or "same" for a move between plans (and billing intervals). */
export function planChange(from: { plan: string; interval: string }, to: { plan: PlanKey; interval: BillingInterval }) {
  const fromRank = rank[from.plan as PlanKey] ?? 0;
  const toRank = rank[to.plan];
  if (toRank > fromRank) return "upgrade" as const;
  if (toRank < fromRank) return "downgrade" as const;
  if (from.interval !== to.interval) return to.interval === "YEAR" ? ("upgrade" as const) : ("downgrade" as const);
  return "same" as const;
}

export function formatPrice(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

/** Yearly billing saves two months. */
export function yearlySaving(plan: PlanDefinition) {
  return plan.price.MONTH * 12 - plan.price.YEAR;
}

/** Usage that a downgrade would leave above the new plan's limits. */
export function downgradeBlockers(usage: Partial<Record<LimitKey, number>>, to: PlanKey) {
  const limits = PLAN_BY_KEY.get(to)!.limits;
  return (Object.keys(limits) as LimitKey[])
    .filter((key) => key !== "aiReplies")
    .filter((key) => limits[key] !== null && (usage[key] ?? 0) > (limits[key] as number))
    .map((key) => ({ key, label: LIMIT_LABELS[key], used: usage[key] ?? 0, limit: limits[key] as number }));
}
