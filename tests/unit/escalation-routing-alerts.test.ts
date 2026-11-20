import { describe, expect, it } from "vitest";
import { escalationAlertText } from "@/src/lib/escalation-alerts";
import { nextInRotation } from "@/src/lib/escalation-routing";
import { SLACK_WEBHOOK_PATTERN } from "@/src/lib/slack-webhook";

describe("UT-72 escalation routing and alerts - Module 9", () => {
  it("UT-72.01 round-robin goes through the team in a stable order and wraps round", () => {
    const team = ["u3", "u1", "u2"];
    expect(nextInRotation(team, null)).toBe("u1");
    expect(nextInRotation(team, "u1")).toBe("u2");
    expect(nextInRotation(team, "u2")).toBe("u3");
    expect(nextInRotation(team, "u3")).toBe("u1");
    expect(nextInRotation([], "u1")).toBeNull();
  });

  it("UT-72.02 when the last person left the rotation (or went offline), the next one in order gets it", () => {
    // u2 was last and is no longer available: u3 is next, nobody is skipped.
    expect(nextInRotation(["u1", "u3"], "u2")).toBe("u3");
    // Only one person available: always them.
    expect(nextInRotation(["u1"], "u1")).toBe("u1");
  });

  it("UT-72.03 alerts say who, where, why, who owns it and link to the escalation", () => {
    const created = escalationAlertText({
      kind: "created",
      escalationId: "esc1",
      customer: "Ali Raza",
      channel: "WHATSAPP",
      priority: "URGENT",
      triggerLabel: "Sensitive topic",
      reason: "Mentioned a chargeback",
      assignee: null,
      slaMinutes: 15,
    });
    expect(created.subject).toBe("Urgent escalation: Ali Raza on WhatsApp");
    expect(created.text).toMatch(/Urgent · Sensitive topic: Mentioned a chargeback/);
    expect(created.text).toMatch(/Waiting in the queue: accept within 15 min\./);
    expect(created.text).toMatch(/\/dashboard\/escalations\?id=esc1$/);

    const overdue = escalationAlertText({
      kind: "sla_breached",
      escalationId: "esc2",
      customer: "Hina",
      channel: "WEB_WIDGET",
      priority: "MEDIUM",
      triggerLabel: "Asked for a person",
      reason: "Wants a human",
      assignee: { fullName: "Sana Malik", email: "sana@example.com" },
      waitedMinutes: 22,
    });
    expect(overdue.subject).toBe("Overdue escalation: Hina has waited 22 min for a person");
    expect(overdue.text).toMatch(/Assigned to Sana Malik, who hasn't accepted it yet\./);
    expect(overdue.text).not.toContain("sana@example.com");
  });

  it("UT-72.04 only Slack incoming-webhook URLs are accepted", () => {
    expect(SLACK_WEBHOOK_PATTERN.test("https://hooks.slack.com/services/T000/B000/abc123")).toBe(true);
    for (const url of ["http://hooks.slack.com/services/T/B/x", "https://hooks.slack.com.evil.com/services/T/B/x", "https://example.com/services/T/B/x", "https://hooks.slack.com/services/T/B/x?redirect=1"]) {
      expect(SLACK_WEBHOOK_PATTERN.test(url)).toBe(false);
    }
  });
});
