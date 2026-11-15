import { describe, expect, it } from "vitest";
import { effectivePlan, limitMessage } from "@/src/lib/billing";
import { PLANS, PLAN_BY_KEY, downgradeBlockers, formatPrice, planChange, yearlySaving } from "@/src/lib/billing-plans";

const now = new Date("2026-11-16T10:00:00Z");
const sub = (plan: string, status: string, trialEndsAt: Date | null = null) => ({ plan, status, trialEndsAt }) as Parameters<typeof effectivePlan>[0];

describe("UT-58 plans, trials and limits - Module 3 FE-1, FE-4", () => {
  it("UT-58.01 offers four tiers, each paid tier including more than the one below", () => {
    expect(PLANS.map((plan) => plan.key)).toEqual(["FREE", "STARTER", "GROWTH", "BUSINESS"]);
    for (let index = 1; index < PLANS.length; index += 1) {
      expect(PLANS[index].price.MONTH).toBeGreaterThan(PLANS[index - 1].price.MONTH);
      expect(PLANS[index].limits.aiReplies!).toBeGreaterThan(PLANS[index - 1].limits.aiReplies!);
    }
    expect(PLAN_BY_KEY.get("BUSINESS")!.limits.agents).toBeNull();
  });

  it("UT-58.02 yearly billing costs ten months", () => {
    const growth = PLAN_BY_KEY.get("GROWTH")!;
    expect(growth.price.YEAR).toBe(growth.price.MONTH * 10);
    expect(yearlySaving(growth)).toBe(growth.price.MONTH * 2);
    expect(formatPrice(4900)).toBe("$49");
    expect(formatPrice(1999)).toBe("$19.99");
  });

  it("UT-58.03 a workspace without a subscription predates billing and is not limited", () => {
    expect(effectivePlan(null, now)).toMatchObject({ plan: null, limited: false });
  });

  it("UT-58.04 a running trial gives the trial plan and counts the days left; an ended one falls to Free", () => {
    expect(effectivePlan(sub("GROWTH", "TRIALING", new Date("2026-11-20T09:00:00Z")), now)).toMatchObject({ plan: "GROWTH", trialing: true, trialDaysLeft: 4, limited: true });
    expect(effectivePlan(sub("GROWTH", "TRIALING", new Date("2026-11-15T09:00:00Z")), now)).toMatchObject({ plan: "FREE", status: "TRIAL_ENDED" });
  });

  it("UT-58.05 a failed renewal keeps the paid plan while payment is retried; cancelled and incomplete are Free", () => {
    expect(effectivePlan(sub("BUSINESS", "PAST_DUE"), now).plan).toBe("BUSINESS");
    expect(effectivePlan(sub("BUSINESS", "CANCELED"), now).plan).toBe("FREE");
    expect(effectivePlan(sub("GROWTH", "INCOMPLETE"), now).plan).toBe("FREE");
  });

  it("UT-58.06 tells an upgrade from a downgrade, including monthly and yearly", () => {
    expect(planChange({ plan: "STARTER", interval: "MONTH" }, { plan: "GROWTH", interval: "MONTH" })).toBe("upgrade");
    expect(planChange({ plan: "BUSINESS", interval: "YEAR" }, { plan: "GROWTH", interval: "YEAR" })).toBe("downgrade");
    expect(planChange({ plan: "GROWTH", interval: "MONTH" }, { plan: "GROWTH", interval: "YEAR" })).toBe("upgrade");
    expect(planChange({ plan: "GROWTH", interval: "YEAR" }, { plan: "GROWTH", interval: "MONTH" })).toBe("downgrade");
    expect(planChange({ plan: "GROWTH", interval: "MONTH" }, { plan: "GROWTH", interval: "MONTH" })).toBe("same");
  });

  it("UT-58.07 blocks a downgrade that would leave more in use than the new plan allows", () => {
    expect(downgradeBlockers({ agents: 4, chatbots: 1, seats: 3, knowledgeSources: 30, aiReplies: 4000 }, "STARTER")).toEqual([
      { key: "agents", label: "AI agents", used: 4, limit: 2 },
      { key: "knowledgeSources", label: "Knowledge sources", used: 30, limit: 25 },
    ]);
    expect(downgradeBlockers({ agents: 1, seats: 2 }, "FREE")).toEqual([]);
  });

  it("UT-58.08 explains a reached limit with the plan and the way out", () => {
    expect(limitMessage("agents", { limit: 2, plan: "STARTER" })).toBe("The Starter plan includes 2 AI agents. Upgrade in Settings → Billing to add more.");
  });
});
