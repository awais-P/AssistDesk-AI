import { describe, expect, it } from "vitest";
import {
  activityHeatmap,
  anonymizeCustomer,
  automationRate,
  clusterQuestions,
  dateKeysBetween,
  delta,
  interactionStatus,
  jaccard,
  latencyBuckets,
  percentile,
  questionTokens,
  safeTimeZone,
  stemToken,
  zonedParts,
} from "@/src/lib/analytics-math";
import { parseAnalyticsRange } from "@/src/lib/analytics";

const sample = (id: string, text: string, overrides: Partial<{ grounded: boolean; usedFallback: boolean; channel: string; at: Date }> = {}) => ({
  id,
  text,
  at: overrides.at ?? new Date("2026-09-30T10:00:00Z"),
  channel: overrides.channel ?? "WEB_WIDGET",
  grounded: overrides.grounded ?? true,
  usedFallback: overrides.usedFallback ?? false,
});

describe("KPI maths (FR-11.1, FR-11.2)", () => {
  it("computes percentiles with the nearest-rank method", () => {
    expect(percentile([100, 200, 300, 400, 1000], 95)).toBe(1000);
    expect(percentile([100, 200, 300, 400], 50)).toBe(200);
    expect(percentile([], 95)).toBeNull();
  });

  it("automation rate = AI-resolved / finished conversations", () => {
    expect(automationRate(["AI_RESOLVED", "AI_RESOLVED", "HUMAN_HANDLED", "UNANSWERED"])).toBe(0.5);
    // Open conversations (no resolution yet) are not counted.
    expect(automationRate(["AI_RESOLVED", null, null])).toBe(1);
    expect(automationRate([])).toBeNull();
  });

  it("compares with the previous period", () => {
    expect(delta(150, 100)).toBe(0.5);
    expect(delta(50, 100)).toBe(-0.5);
    expect(delta(10, 0)).toBeNull();
    expect(delta(null, 10)).toBeNull();
  });

  it("maps sessions to FR-11.6 statuses", () => {
    expect(interactionStatus({ status: "CLOSED", resolution: "AI_RESOLVED" })).toBe("AI_RESOLVED");
    expect(interactionStatus({ status: "CLOSED", resolution: "HUMAN_HANDLED" })).toBe("ESCALATED");
    expect(interactionStatus({ status: "CLOSED", resolution: "UNANSWERED" })).toBe("UNANSWERED");
    expect(interactionStatus({ status: "ESCALATED", resolution: null })).toBe("WITH_TEAM");
    expect(interactionStatus({ status: "ACTIVE", resolution: null })).toBe("ACTIVE");
  });

  it("anonymises customers in exports", () => {
    expect(anonymizeCustomer("Ayesha Khan", "cmabc123wxyz")).toBe("AK · WXYZ");
    expect(anonymizeCustomer(null, "cmabc123wxyz")).toBe("Visitor · WXYZ");
  });
});

describe("time buckets in the workspace time zone (FR-11.5)", () => {
  it("reads calendar parts in a time zone", () => {
    // 2026-09-30 21:30 UTC is 2026-10-01 02:30 in Karachi (UTC+5), a Thursday.
    expect(zonedParts(new Date("2026-09-30T21:30:00Z"), "Asia/Karachi")).toEqual({ dateKey: "2026-10-01", hour: 2, weekday: 3 });
    expect(safeTimeZone("Not/AZone")).toBe("UTC");
  });

  it("builds 24 hourly latency buckets labelled HH:00 with gaps for empty hours", () => {
    const now = new Date("2026-09-30T12:20:00Z");
    const buckets = latencyBuckets(
      [
        { at: new Date("2026-09-30T12:05:00Z"), latencyMs: 400 },
        { at: new Date("2026-09-30T12:10:00Z"), latencyMs: 600 },
        { at: new Date("2026-09-30T02:00:00Z"), latencyMs: 900 },
        { at: new Date("2026-09-28T12:00:00Z"), latencyMs: 5000 },
      ],
      now,
      "UTC",
    );

    expect(buckets).toHaveLength(24);
    expect(buckets.at(-1)).toMatchObject({ label: "12:00", count: 2, avgMs: 500, p95Ms: 600 });
    expect(buckets.find((bucket) => bucket.label === "02:00")).toMatchObject({ count: 1, avgMs: 900 });
    expect(buckets.find((bucket) => bucket.label === "05:00")).toMatchObject({ count: 0, avgMs: null });
    // Samples older than 24 hours are ignored.
    expect(buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(3);
  });

  it("counts activity per weekday and hour", () => {
    const grid = activityHeatmap([new Date("2026-09-28T09:15:00Z"), new Date("2026-09-28T09:45:00Z")], "UTC");
    expect(grid[0][9]).toBe(2); // Monday 09:00
    expect(grid.flat().reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("lists every day in the range", () => {
    expect(dateKeysBetween(new Date("2026-09-28T00:00:00Z"), new Date("2026-09-30T12:00:00Z"), "UTC")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
    ]);
  });
});

describe("frequently asked questions (FE-4)", () => {
  it("ignores filler words and numbers", () => {
    expect(questionTokens("Hi, what is the price of the 50 kettles?")).toEqual(["pric", "kettl"]);
    expect(["deliver", "delivery", "delivered", "deliveries"].map(stemToken)).toEqual(["deliver", "deliver", "deliver", "deliver"]);
    expect(["price", "prices", "pricing"].map(stemToken)).toEqual(["pric", "pric", "pric"]);
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });

  it("groups differently worded questions and ranks them by frequency", () => {
    const clusters = clusterQuestions([
      sample("1", "What is your refund policy?"),
      sample("2", "refund policy please"),
      sample("3", "What's the refund policy for damaged items?", { grounded: false }),
      sample("4", "Do you deliver to Lahore?"),
      sample("5", "Delivery to Lahore?"),
      sample("6", "How do I reset my password?", { channel: "WHATSAPP" }),
    ]);

    expect(clusters[0].count).toBe(3);
    expect(clusters[0].label.toLowerCase()).toContain("refund");
    expect(clusters[0].answeredRate).toBeCloseTo(2 / 3);
    expect(clusters[1].count).toBe(2);
    expect(clusters.find((cluster) => cluster.label.includes("password"))?.channels).toEqual({ WHATSAPP: 1 });
  });

  it("joins a short question contained in a longer one", () => {
    const clusters = clusterQuestions([
      sample("1", "Refund question: what is your refund policy for damaged kettles?"),
      sample("2", "refund policy please"),
      sample("3", "What is your refund policy?"),
      sample("4", "price?"),
      sample("5", "What's the price of the steel kettle and the glass kettle?"),
    ]);
    expect(clusters[0].count).toBe(3);
    // A single word is too little evidence to merge on containment alone.
    expect(clusters.find((cluster) => cluster.label === "price?")?.count).toBe(1);
  });

  it("uses semantic vectors when they are available", () => {
    const vectors = new Map([
      ["a", [1, 0]],
      ["b", [0.99, 0.05]],
    ]);
    const clusters = clusterQuestions([sample("a", "shipping cost to Karachi"), sample("b", "delivery charges Karachi")], { vectors });
    expect(clusters).toHaveLength(1);
  });
});

describe("analytics date range", () => {
  const now = new Date("2026-09-30T12:00:00Z");

  it("defaults to 7 days and computes the previous period", () => {
    const range = parseAnalyticsRange(new URLSearchParams(""), "Asia/Karachi", now);
    expect(range.preset).toBe("7d");
    expect(range.to).toEqual(now);
    expect(now.getTime() - range.from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(range.previousTo).toEqual(range.from);
  });

  it("accepts custom dates, capped at 180 days and never in the future", () => {
    const range = parseAnalyticsRange(new URLSearchParams("from=2025-01-01&to=2027-01-01&channel=WHATSAPP"), "UTC", now);
    expect(range.preset).toBe("custom");
    expect(range.to).toEqual(now);
    expect(Math.round((range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000))).toBe(180);
    expect(range.channel).toBe("WHATSAPP");
  });

  it("rejects unknown channels and presets", () => {
    const range = parseAnalyticsRange(new URLSearchParams("range=1y&channel=FAX"), "UTC", now);
    expect(range.preset).toBe("7d");
    expect(range.channel).toBeNull();
  });
});
