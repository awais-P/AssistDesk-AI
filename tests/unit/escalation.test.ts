import { describe, expect, it } from "vitest";
import {
  DEFAULT_ESCALATION_SETTINGS,
  evaluateEscalation,
  isHumanRequest,
  matchKeyword,
  matchSensitiveTopic,
  scoreSentiment,
  slaDueAt,
} from "@/src/lib/escalation-triggers";
import { customerNoticeFor } from "@/src/lib/escalation";
import { computeEscalationStats, escalationsToCsv, parseEscalationSettings, type SerializedEscalation } from "@/src/lib/escalation-queries";
import { fallbackEscalationSummary, moodLabel } from "@/src/lib/escalation-summary";

const settings = { ...DEFAULT_ESCALATION_SETTINGS };

describe("UT-50 sentiment of a customer message - Module 9 FE-3", () => {
  it("UT-50.01 scores a clearly negative English message below the default threshold", () => {
    expect(scoreSentiment("This is the worst service ever!!")).toBeLessThanOrEqual(-0.5);
  });

  it("UT-50.02 scores a thankful message as positive", () => {
    expect(scoreSentiment("Thank you so much, that was very helpful")).toBeGreaterThan(0.4);
  });

  it("UT-50.03 scores a plain question as neutral", () => {
    expect(scoreSentiment("What time do you open on Saturday?")).toBe(0);
  });

  it("UT-50.04 flips a negated word: not happy is negative, not bad is positive", () => {
    expect(scoreSentiment("I am not happy with this")).toBeLessThan(0);
    expect(scoreSentiment("not bad at all")).toBeGreaterThan(0);
  });

  it("UT-50.05 makes an intensified word stronger", () => {
    expect(scoreSentiment("very disappointed")).toBeLessThan(scoreSentiment("disappointed"));
  });

  it("UT-50.06 understands Roman Urdu, including negation after the word", () => {
    expect(scoreSentiment("bohat bakwas service hai")).toBeLessThanOrEqual(-0.5);
    expect(scoreSentiment("ye acha nahi hai")).toBeLessThan(0);
    expect(scoreSentiment("shukriya, zabardast")).toBeGreaterThan(0.5);
  });

  it("UT-50.07 understands Urdu", () => {
    expect(scoreSentiment("یہ سروس بہت بکواس ہے")).toBeLessThanOrEqual(-0.5);
    expect(scoreSentiment("شکریہ")).toBeGreaterThan(0);
  });

  it("UT-50.08 makes shouting more negative", () => {
    expect(scoreSentiment("THIS IS NOT WORKING AGAIN!!")).toBeLessThan(scoreSentiment("this is not working again"));
  });
});

describe("UT-51 requests for a person and sensitive topics - Module 9 FE-1", () => {
  it("UT-51.01 recognises English requests for a person", () => {
    for (const text of ["Can I talk to a human?", "I want to speak to a manager", "connect me with a real person please", "I need an agent"]) {
      expect(isHumanRequest(text), text).toBe(true);
    }
  });

  it("UT-51.02 recognises Roman Urdu and Urdu requests for a person", () => {
    for (const text of ["kisi insaan se baat karwao", "kisi se baat karwa do", "انسان سے بات کرنی ہے"]) {
      expect(isHumanRequest(text), text).toBe(true);
    }
  });

  it("UT-51.03 does not treat a question about the assistant as a request", () => {
    expect(isHumanRequest("Are you a real person?")).toBe(false);
    expect(isHumanRequest("kya aap insaan ho?")).toBe(false);
    expect(isHumanRequest("Where is my order 1042?")).toBe(false);
  });

  it("UT-51.04 finds sensitive topics with their priority", () => {
    expect(matchSensitiveTopic("I will talk to my lawyer about this")).toMatchObject({ label: "legal action", priority: "HIGH" });
    expect(matchSensitiveTopic("You charged twice on my card")).toMatchObject({ label: "payment dispute" });
    expect(matchSensitiveTopic("I want to end my life")).toMatchObject({ priority: "URGENT" });
    expect(matchSensitiveTopic("Do you have the kettle in blue?")).toBeNull();
  });

  it("UT-51.05 matches the workspace's own trigger phrases as whole words", () => {
    expect(matchKeyword("Please give me a refund now", ["refund", "warranty claim"])).toBe("refund");
    expect(matchKeyword("refunded already, thanks", ["refund"])).toBeNull();
  });
});

describe("UT-52 escalation decision - Module 9 FE-1, FE-3", () => {
  it("UT-52.01 escalates a single very negative message as SENTIMENT", () => {
    const { decision } = evaluateEscalation({ message: "This is ridiculous, worst support ever!!", settings });
    expect(decision).toMatchObject({ trigger: "SENTIMENT" });
    expect(decision?.reason).toMatch(/Negative sentiment/);
  });

  it("UT-52.02 escalates growing frustration over three negative messages", () => {
    const { decision } = evaluateEscalation({ message: "still not working", settings, recentSentiments: [-0.4, -0.4] });
    expect(decision).toMatchObject({ trigger: "SENTIMENT" });
    expect(decision?.reason).toMatch(/Growing frustration/);
  });

  it("UT-52.03 does not escalate a mildly negative message on its own", () => {
    expect(evaluateEscalation({ message: "my order is late", settings }).decision).toBeNull();
  });

  it("UT-52.04 escalates a request for a person as HUMAN_REQUEST", () => {
    expect(evaluateEscalation({ message: "can I talk to a human please", settings }).decision).toMatchObject({ trigger: "HUMAN_REQUEST", priority: "MEDIUM" });
  });

  it("UT-52.05 puts sensitive topics and trigger phrases before sentiment", () => {
    expect(evaluateEscalation({ message: "This is a scam, I am calling the police", settings }).decision).toMatchObject({ trigger: "KEYWORD", priority: "HIGH" });
    expect(evaluateEscalation({ message: "I want a refund", settings: { ...settings, keywords: ["refund"] } }).decision).toMatchObject({ trigger: "KEYWORD" });
  });

  it("UT-52.06 sends a customer kept with the team straight to a human", () => {
    expect(evaluateEscalation({ message: "hi", settings, contactAiPaused: true }).decision).toMatchObject({ trigger: "CUSTOMER_FLAGGED" });
  });

  it("UT-52.07 respects the switches in the settings", () => {
    expect(evaluateEscalation({ message: "worst service ever!!", settings: { ...settings, enabled: false } }).decision).toBeNull();
    expect(evaluateEscalation({ message: "worst service ever!!", settings: { ...settings, sentimentEnabled: false } }).decision).toBeNull();
    expect(evaluateEscalation({ message: "talk to a human", settings: { ...settings, onHumanRequest: false } }).decision).toBeNull();
    expect(evaluateEscalation({ message: "my lawyer will call", settings: { ...settings, sensitiveTopics: false } }).decision).toBeNull();
  });

  it("UT-52.08 follows a stricter or looser sentiment threshold", () => {
    expect(evaluateEscalation({ message: "disappointed", settings: { ...settings, sentimentThreshold: -0.3 } }).decision).toMatchObject({ trigger: "SENTIMENT" });
    expect(evaluateEscalation({ message: "very disappointed", settings: { ...settings, sentimentThreshold: -0.8 } }).decision).toBeNull();
  });

  it("UT-52.09 always returns the message's sentiment so it can be stored", () => {
    expect(evaluateEscalation({ message: "thank you!", settings }).sentiment).toBeGreaterThan(0);
  });

  it("UT-52.10 sets the SLA deadline from the workspace's minutes", () => {
    expect(slaDueAt(new Date("2026-11-15T10:00:00Z"), 15).toISOString()).toBe("2026-11-15T10:15:00.000Z");
  });
});

describe("UT-53 escalation queue, report and settings - Module 9 FE-4, FE-6", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 15, 10, minutes));

  it("UT-53.01 counts waiting, in-progress and overdue escalations", () => {
    const stats = computeEscalationStats(
      [
        { status: "PENDING", trigger: "SENTIMENT", createdAt: at(0), acceptedAt: null, resolvedAt: null, slaDueAt: at(15), slaBreachedAt: null },
        { status: "PENDING", trigger: "HUMAN_REQUEST", createdAt: at(0), acceptedAt: null, resolvedAt: null, slaDueAt: at(5), slaBreachedAt: null },
        { status: "ACCEPTED", trigger: "AI_TOOL", createdAt: at(0), acceptedAt: at(4), resolvedAt: null, slaDueAt: at(15), slaBreachedAt: null },
        { status: "RESOLVED", trigger: "KEYWORD", createdAt: at(0), acceptedAt: at(20), resolvedAt: at(30), slaDueAt: at(15), slaBreachedAt: at(15) },
      ],
      at(10),
    );
    expect(stats).toMatchObject({ pending: 2, inProgress: 1, overdue: 1, resolved: 1, total: 4 });
  });

  it("UT-53.02 measures time to accept and SLA met, leaving out manual take-overs", () => {
    const stats = computeEscalationStats([
      { status: "ACCEPTED", trigger: "AI_TOOL", createdAt: at(0), acceptedAt: at(4), resolvedAt: null, slaDueAt: at(15), slaBreachedAt: null },
      { status: "RESOLVED", trigger: "KEYWORD", createdAt: at(0), acceptedAt: at(20), resolvedAt: at(30), slaDueAt: at(15), slaBreachedAt: at(15) },
      { status: "ACCEPTED", trigger: "MANUAL", createdAt: at(0), acceptedAt: at(0), resolvedAt: null, slaDueAt: null, slaBreachedAt: null },
    ]);
    expect(stats.averageAcceptMinutes).toBe(12);
    expect(stats.slaMetPercent).toBe(50);
    expect(stats.byTrigger).toEqual({ AI_TOOL: 1, KEYWORD: 1, MANUAL: 1 });
  });

  it("UT-53.03 exports a CSV that a spreadsheet cannot run as a formula", () => {
    const item = {
      createdAt: "2026-11-15T10:00:00.000Z",
      customer: "=HYPERLINK(evil)",
      channel: "WEB_WIDGET",
      triggerLabel: "Asked for a person",
      reason: 'Said "help, now"',
      priority: "HIGH",
      status: "PENDING",
      assignee: null,
      acceptedAt: null,
      resolvedAt: null,
      resolution: null,
      slaBreached: false,
      sentimentScore: -0.6,
      summary: null,
    } as unknown as SerializedEscalation;
    const [header, row] = escalationsToCsv([item]).split("\r\n");
    expect(header.startsWith("Created,Customer,Channel,Trigger")).toBe(true);
    expect(row).toContain("'=HYPERLINK(evil)");
    expect(row).toContain('"Said ""help, now"""');
  });

  it("UT-53.04 accepts valid settings and normalises trigger phrases", () => {
    expect(parseEscalationSettings({ enabled: false, sentimentThreshold: -0.62, slaMinutes: 30, keywords: [" Refund ", "refund", "warranty claim"] })).toEqual({
      data: { escalationEnabled: false, escalationSentimentThreshold: -0.62, escalationSlaMinutes: 30, escalationKeywords: ["refund", "warranty claim"] },
    });
  });

  it("UT-53.05 rejects settings outside the allowed ranges", () => {
    expect(parseEscalationSettings({ sentimentThreshold: 0.5 }).error).toMatch(/threshold/);
    expect(parseEscalationSettings({ slaMinutes: 0 }).error).toMatch(/response time/);
    expect(parseEscalationSettings({ keywords: ["ok"] }).error).toMatch(/3 to 60/);
    expect(parseEscalationSettings({ keywords: Array.from({ length: 31 }, (_, index) => `phrase ${index}`) }).error).toMatch(/Up to 30/);
    expect(parseEscalationSettings({ enabled: "yes" }).error).toMatch(/true or false/);
  });

  it("UT-53.06 tells the customer what happens, with emergency advice when urgent", () => {
    expect(customerNoticeFor("HUMAN_REQUEST", "MEDIUM")).toMatch(/connecting you with a member of our team/);
    expect(customerNoticeFor("SENTIMENT", "HIGH")).toMatch(/sorry/);
    expect(customerNoticeFor("KEYWORD", "URGENT")).toMatch(/emergency services/);
  });

  it("UT-53.07 builds a hand-over brief from the messages when no AI model is available", () => {
    const brief = fallbackEscalationSummary({
      messages: [
        { sender: "USER", content: "My kettle from order 1042 arrived broken" },
        { sender: "AI", content: "Sorry to hear that. Could you share a photo?" },
        { sender: "USER", content: "I want to talk to a person" },
      ],
      trigger: "HUMAN_REQUEST",
      reason: "Customer asked for a person",
      sentiment: -0.8,
    });
    expect(brief).toContain("Issue: My kettle from order 1042 arrived broken");
    expect(brief).toContain("Latest from the customer: I want to talk to a person");
    expect(brief).toContain("Mood: very upset");
    expect(brief).toContain("Asked for a person");
    expect(moodLabel(null)).toBe("unknown");
  });
});
