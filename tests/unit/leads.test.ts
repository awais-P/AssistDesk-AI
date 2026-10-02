import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAD_FORM,
  computeLeadScore,
  detectPurchaseIntent,
  extractContactDetails,
  formatSuccessMessage,
  leadTemperature,
  parseLeadForm,
  publicLeadForm,
  shouldPromptLead,
  validateLeadSubmission,
} from "@/src/lib/lead-form";
import { csvCell } from "@/src/lib/lead-list";
import { signWebhookPayload, verifyWebhookSignature } from "@/src/lib/webhooks";

const enabledForm = parseLeadForm({ ...DEFAULT_LEAD_FORM, enabled: true });

describe("lead form config (FE-1)", () => {
  it("falls back to the default form for missing or invalid config", () => {
    expect(parseLeadForm(null).enabled).toBe(false);
    expect(parseLeadForm("nonsense").fields.map((field) => field.key)).toEqual(["name", "email", "phone"]);
  });

  it("sanitises fields: keys, duplicates, types, select options and limits", () => {
    const form = parseLeadForm({
      enabled: true,
      trigger: "AFTER_MESSAGES",
      afterMessages: 99,
      fields: [
        { key: "Email", label: "Work email", type: "text", required: true },
        { key: "email", label: "Duplicate", type: "email" },
        { key: "budget range", label: "Budget", type: "select", options: ["< 1 lakh", "1–5 lakh", "1–5 lakh"] },
        { key: "size", label: "Team size", type: "select", options: ["only one"] },
        { key: "", label: "No key" },
        { key: "x", label: "" },
      ],
    });

    expect(form.fields.map((field) => field.key)).toEqual(["email", "budget_range", "size"]);
    expect(form.fields[0].type).toBe("email");
    expect(form.fields[1].options).toEqual(["< 1 lakh", "1–5 lakh"]);
    // A dropdown with fewer than two options becomes a text field.
    expect(form.fields[2].type).toBe("text");
    expect(form.afterMessages).toBe(20);
  });

  it("always has a way to reach the person", () => {
    const form = parseLeadForm({ enabled: true, fields: [{ key: "company", label: "Company", type: "text" }] });
    expect(form.fields[0]).toMatchObject({ key: "email", required: true });
  });

  it("exposes only the public part of the form to the widget", () => {
    expect(publicLeadForm(parseLeadForm({ enabled: false }))).toBeNull();
    const form = publicLeadForm(enabledForm);
    expect(form).not.toHaveProperty("trigger");
    expect(form).not.toHaveProperty("successMessage");
    expect(form?.fields.length).toBe(3);
  });

  it("personalises the success message", () => {
    expect(formatSuccessMessage(enabledForm, "Ali Khan")).toBe("Thanks, Ali! Our team will be in touch soon.");
    expect(formatSuccessMessage(enabledForm, null)).toBe("Thanks! Our team will be in touch soon.");
  });
});

describe("lead form validation (SRS: email format, required fields)", () => {
  it("normalises valid submissions and separates custom answers", () => {
    const form = parseLeadForm({
      enabled: true,
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
        { key: "phone", label: "Phone", type: "phone" },
        { key: "budget", label: "Budget", type: "select", options: ["Small", "Large"] },
      ],
    });
    const result = validateLeadSubmission(form, {
      name: " Ali ",
      email: "ALI@Example.com",
      phone: "0300-1234567",
      budget: "Large",
    });

    expect(result).toEqual({
      ok: true,
      values: {
        name: "Ali",
        email: "ali@example.com",
        phone: "+923001234567",
        company: null,
        fields: [{ key: "budget", label: "Budget", value: "Large" }],
      },
    });
  });

  it("reports every invalid field", () => {
    const result = validateLeadSubmission(enabledForm, { name: "", email: "not-an-email", phone: "12" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["email", "name", "phone"]);
    }
  });

  it("rejects options that are not in the dropdown", () => {
    const form = parseLeadForm({
      enabled: true,
      fields: [
        { key: "email", label: "Email", type: "email", required: true },
        { key: "plan", label: "Plan", type: "select", options: ["Basic", "Pro"] },
      ],
    });
    const result = validateLeadSubmission(form, { email: "a@b.co", plan: "Hacked" });
    expect(result.ok).toBe(false);
  });

  it("needs at least an email or phone even if both are optional", () => {
    const form = parseLeadForm({
      enabled: true,
      fields: [
        { key: "name", label: "Name", type: "text" },
        { key: "email", label: "Email", type: "email" },
      ],
    });
    const result = validateLeadSubmission(form, { name: "Ali" });
    expect(result.ok).toBe(false);
  });
});

describe("when to show the form", () => {
  const base = { leadState: null, customerMessageCount: 1, message: "Hello", alreadyLead: false };

  it("detects buying intent in English, Roman Urdu and Urdu", () => {
    expect(detectPurchaseIntent("How much does the Pro plan cost?")).toBeTruthy();
    expect(detectPurchaseIntent("Can I get a quote for 50 kettles?")).toBeTruthy();
    expect(detectPurchaseIntent("I'd like to book a demo")).toBeTruthy();
    expect(detectPurchaseIntent("ye kettle kitne ka hai?")).toBeTruthy();
    expect(detectPurchaseIntent("اس کی قیمت کیا ہے؟")).toBeTruthy();
    expect(detectPurchaseIntent("What are your opening hours?")).toBeNull();
  });

  it("does not treat complaints as buying intent", () => {
    expect(detectPurchaseIntent("I want a refund, the price was wrong")).toBeNull();
    expect(detectPurchaseIntent("Where is my order? I paid the full price")).toBeNull();
  });

  it("follows the configured trigger", () => {
    const intentForm = parseLeadForm({ ...DEFAULT_LEAD_FORM, enabled: true, trigger: "ON_INTENT" });
    expect(shouldPromptLead({ ...base, form: intentForm, message: "What's the price?" })).toBe(true);
    expect(shouldPromptLead({ ...base, form: intentForm })).toBe(false);

    const afterForm = parseLeadForm({ ...DEFAULT_LEAD_FORM, enabled: true, trigger: "AFTER_MESSAGES", afterMessages: 3 });
    expect(shouldPromptLead({ ...base, form: afterForm, customerMessageCount: 2 })).toBe(false);
    expect(shouldPromptLead({ ...base, form: afterForm, customerMessageCount: 3 })).toBe(true);

    const firstForm = parseLeadForm({ ...DEFAULT_LEAD_FORM, enabled: true, trigger: "FIRST_MESSAGE" });
    expect(shouldPromptLead({ ...base, form: firstForm })).toBe(true);
  });

  it("asks only once per conversation and never an existing lead", () => {
    const form = parseLeadForm({ ...DEFAULT_LEAD_FORM, enabled: true, trigger: "FIRST_MESSAGE" });
    expect(shouldPromptLead({ ...base, form, leadState: "SKIPPED" })).toBe(false);
    expect(shouldPromptLead({ ...base, form, leadState: "CAPTURED" })).toBe(false);
    expect(shouldPromptLead({ ...base, form, alreadyLead: true })).toBe(false);
    expect(shouldPromptLead({ ...base, form: parseLeadForm({ enabled: false }) })).toBe(false);
  });
});

describe("contact details typed in chat (FE-2)", () => {
  it("finds emails and phone numbers", () => {
    expect(extractContactDetails("you can mail me at Ayesha.K@Example.com thanks")).toEqual({
      email: "ayesha.k@example.com",
      phone: null,
    });
    expect(extractContactDetails("call me on 0300 1234567 after 5").phone).toBe("+923001234567");
    expect(extractContactDetails("my number is +44 20 7946 0958").phone).toBe("+442079460958");
  });

  it("does not mistake order numbers or dates for phones", () => {
    expect(extractContactDetails("order #1042 placed on 2026-09-29").phone).toBeNull();
    expect(extractContactDetails("invoice 458103").phone).toBeNull();
  });
});

describe("lead score", () => {
  const empty = {
    hasEmail: false,
    hasPhone: false,
    hasName: false,
    hasCompany: false,
    customAnswers: 0,
    buyingIntent: false,
    customerMessages: 1,
    returningCustomer: false,
    marketingConsent: false,
  };

  it("rewards reachability, identity, engagement and consent", () => {
    expect(computeLeadScore({ ...empty, hasEmail: true })).toBe(20);
    expect(
      computeLeadScore({
        ...empty,
        hasEmail: true,
        hasPhone: true,
        hasName: true,
        hasCompany: true,
        customAnswers: 2,
        buyingIntent: true,
        customerMessages: 9,
        returningCustomer: true,
        marketingConsent: true,
      }),
    ).toBe(100);
  });

  it("maps scores to hot / warm / cold", () => {
    expect(leadTemperature(75)).toBe("HOT");
    expect(leadTemperature(40)).toBe("WARM");
    expect(leadTemperature(39)).toBe("COLD");
  });
});

describe("export and webhooks (FE-4)", () => {
  it("quotes CSV cells and defuses spreadsheet formulas", () => {
    expect(csvCell('Khan, "Ali"')).toBe('"Khan, ""Ali"""');
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+923001234567")).toBe("'+923001234567");
    expect(csvCell(null)).toBe("");
  });

  it("signs payloads so receivers can verify them", () => {
    const secret = "whsec_test_secret";
    const body = JSON.stringify({ event: "lead.created", data: { id: "lead_1" } });
    const now = Date.UTC(2026, 8, 30, 12, 0, 0);
    const timestamp = Math.floor(now / 1000);
    const header = signWebhookPayload(secret, timestamp, body);

    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature({ secret, header, body, now })).toBe(true);
    expect(verifyWebhookSignature({ secret, header, body: `${body} `, now })).toBe(false);
    expect(verifyWebhookSignature({ secret: "other", header, body, now })).toBe(false);
    // Replayed more than 5 minutes later.
    expect(verifyWebhookSignature({ secret, header, body, now: now + 6 * 60 * 1000 })).toBe(false);
  });
});
