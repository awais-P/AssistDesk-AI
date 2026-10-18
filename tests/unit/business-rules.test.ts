import { describe, expect, it } from "vitest";
import { parseChatbotDomainInput } from "@/src/lib/chatbot-config";
import { isAllowedWidgetHost } from "@/src/lib/chatbot-widget";
import { DEFAULT_LEAD_FORM, parseLeadForm, shouldPromptLead } from "@/src/lib/lead-form";

/**
 * Business-rule tests (Chapter 5.3 and Appendix C of the final report). Each group tests one
 * business rule with a decision table; each test is one rule (R1, R2, ...) of that table.
 * BR-1, BR-2, BR-3 and BR-5 run against a database in tests/integration/business-rules.int.ts.
 */

/** BR-4, allowed widget domains: valid, not duplicated, and the widget loads only on them. */
describe("UT-46 BR-4 allowed widget domains - FR-4.3, FR-13.4", () => {
  it("UT-46.01 R1 a valid domain entered by an admin is added in its plain form", () => {
    expect(parseChatbotDomainInput("https://www.Shop.Example.com/pricing", [])).toEqual({ domain: "shop.example.com" });
  });

  it("UT-46.02 R2 a domain in the wrong format is refused with a message", () => {
    expect(parseChatbotDomainInput("not a domain", []).error).toMatch(/is not a valid domain/);
  });

  it("UT-46.03 R3 a domain that is already in the list is refused as a duplicate", () => {
    expect(parseChatbotDomainInput("example.com", ["example.com"]).error).toBe("example.com is already in the list.");
  });

  it("UT-46.04 R4 the widget loads on an allowed domain and its subdomains", () => {
    expect(isAllowedWidgetHost("example.com", ["example.com"])).toBe(true);
    expect(isAllowedWidgetHost("shop.example.com", ["example.com"])).toBe(true);
  });

  it("UT-46.05 R5 the widget does not load on a domain that is not in the list", () => {
    expect(isAllowedWidgetHost("another-shop.com", ["example.com"])).toBe(false);
  });
});

/**
 * BR-7, when the lead form is shown in the widget (Module 8 FE-1, Algorithm 8): only if it is
 * enabled, at most once per conversation, never to an existing lead, and only when its trigger is met.
 */
describe("UT-47 BR-7 when the lead form is shown - Module 8 FE-1", () => {
  const chat = { leadState: null, customerMessageCount: 1, message: "Hello", alreadyLead: false };
  const form = (config: Record<string, unknown>) => parseLeadForm({ ...DEFAULT_LEAD_FORM, enabled: true, ...config });

  it("UT-47.01 R1 a disabled lead form is never shown", () => {
    expect(shouldPromptLead({ ...chat, form: parseLeadForm({ ...DEFAULT_LEAD_FORM, enabled: false, trigger: "FIRST_MESSAGE" }) })).toBe(false);
  });

  it("UT-47.02 R2 a visitor who is already a lead is not asked again", () => {
    expect(shouldPromptLead({ ...chat, form: form({ trigger: "FIRST_MESSAGE" }), alreadyLead: true })).toBe(false);
  });

  it("UT-47.03 R3 the form is shown only once per conversation, even if it was skipped", () => {
    for (const leadState of ["PROMPTED", "SKIPPED", "CAPTURED"]) {
      expect(shouldPromptLead({ ...chat, form: form({ trigger: "FIRST_MESSAGE" }), leadState }), leadState).toBe(false);
    }
  });

  it("UT-47.04 R4 with the First message trigger the form is shown on the first message", () => {
    expect(shouldPromptLead({ ...chat, form: form({ trigger: "FIRST_MESSAGE" }) })).toBe(true);
  });

  it("UT-47.05 R5 with the After 3 messages trigger the form waits on the second message", () => {
    expect(shouldPromptLead({ ...chat, form: form({ trigger: "AFTER_MESSAGES", afterMessages: 3 }), customerMessageCount: 2 })).toBe(false);
  });

  it("UT-47.06 R6 with the After 3 messages trigger the form is shown on the third message", () => {
    expect(shouldPromptLead({ ...chat, form: form({ trigger: "AFTER_MESSAGES", afterMessages: 3 }), customerMessageCount: 3 })).toBe(true);
  });

  it("UT-47.07 R7 with the Buying intent trigger the form is shown when the visitor asks for a price", () => {
    expect(shouldPromptLead({ ...chat, form: form({ trigger: "ON_INTENT" }), message: "How much for 40 kettles for my hotel?" })).toBe(true);
  });

  it("UT-47.08 R8 with the Buying intent trigger the form is not shown for a support question or complaint", () => {
    expect(shouldPromptLead({ ...chat, form: form({ trigger: "ON_INTENT" }), message: "What are your opening hours?" })).toBe(false);
    expect(shouldPromptLead({ ...chat, form: form({ trigger: "ON_INTENT" }), message: "I want a refund, the price was wrong" })).toBe(false);
  });
});
