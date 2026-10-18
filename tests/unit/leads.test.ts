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

describe("UT-27 lead form config - FE-1", () => {
  it("UT-27.01 falls back to the default form for missing or invalid config", () => {
    expect(parseLeadForm(null).enabled).toBe(false);
    expect(parseLeadForm("nonsense").fields.map((field) => field.key)).toEqual(["name", "email", "phone"]);
  });

  it("UT-27.02 sanitises fields: keys, duplicates, types, select options and limits", () => {
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

  it("UT-27.03 always has a way to reach the person", () => {
    const form = parseLeadForm({ enabled: true, fields: [{ key: "company", label: "Company", type: "text" }] });
    expect(form.fields[0]).toMatchObject({ key: "email", required: true });
  });

  it("UT-27.04 exposes only the public part of the form to the widget", () => {
    expect(publicLeadForm(parseLeadForm({ enabled: false }))).toBeNull();
    const form = publicLeadForm(enabledForm);
    expect(form).not.toHaveProperty("trigger");
    expect(form).not.toHaveProperty("successMessage");
    expect(form?.fields.length).toBe(3);
  });

  it("UT-27.05 personalises the success message", () => {
    expect(formatSuccessMessage(enabledForm, "Ali Khan")).toBe("Thanks, Ali! Our team will be in touch soon.");
    expect(formatSuccessMessage(enabledForm, null)).toBe("Thanks! Our team will be in touch soon.");
  });
});

describe("UT-28 lead form validation - SRS: email format, required fields", () => {
  it("UT-28.01 normalises valid submissions and separates custom answers", () => {
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

  it("UT-28.02 reports every invalid field", () => {
    const result = validateLeadSubmission(enabledForm, { name: "", email: "not-an-email", phone: "12" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["email", "name", "phone"]);
    }
  });

  it("UT-28.03 rejects options that are not in the dropdown", () => {
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

  it("UT-28.04 needs at least an email or phone even if both are optional", () => {
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

describe("UT-29 when to show the form", () => {
  const base = { leadState: null, customerMessageCount: 1, message: "Hello", alreadyLead: false };

  it("UT-29.01 detects buying intent in English", () => {
    expect(detectPurchaseIntent("How much does the Pro plan cost?")).toBeTruthy();
    expect(detectPurchaseIntent("Can I get a quote for 50 kettles?")).toBeTruthy();
    expect(detectPurchaseIntent("I'd like to book a demo")).toBeTruthy();
  });

  it("UT-29.02 detects buying intent in Roman Urdu", () => {
    expect(detectPurchaseIntent("ye kettle kitne ka hai?")).toBeTruthy();
  });

  it("UT-29.03 detects buying intent in Urdu", () => {
    expect(detectPurchaseIntent("اس کی قیمت کیا ہے؟")).toBeTruthy();
  });

  it("UT-29.04 finds no buying intent in a general question", () => {
    expect(detectPurchaseIntent("What are your opening hours?")).toBeNull();
  });

  it("UT-29.05 does not treat complaints as buying intent", () => {
    expect(detectPurchaseIntent("I want a refund, the price was wrong")).toBeNull();
    expect(detectPurchaseIntent("Where is my order? I paid the full price")).toBeNull();
  });

  it("UT-29.06 follows the configured trigger", () => {
    const intentForm = parseLeadForm({ ...DEFAULT_LEAD_FORM, enabled: true, trigger: "ON_INTENT" });
    expect(shouldPromptLead({ ...base, form: intentForm, message: "What's the price?" })).toBe(true);
    expect(shouldPromptLead({ ...base, form: intentForm })).toBe(false);

    const afterForm = parseLeadForm({ ...DEFAULT_LEAD_FORM, enabled: true, trigger: "AFTER_MESSAGES", afterMessages: 3 });
    expect(shouldPromptLead({ ...base, form: afterForm, customerMessageCount: 2 })).toBe(false);
    expect(shouldPromptLead({ ...base, form: afterForm, customerMessageCount: 3 })).toBe(true);

    const firstForm = parseLeadForm({ ...DEFAULT_LEAD_FORM, enabled: true, trigger: "FIRST_MESSAGE" });
    expect(shouldPromptLead({ ...base, form: firstForm })).toBe(true);
  });

  it("UT-29.07 asks only once per conversation and never an existing lead", () => {
    const form = parseLeadForm({ ...DEFAULT_LEAD_FORM, enabled: true, trigger: "FIRST_MESSAGE" });
    expect(shouldPromptLead({ ...base, form, leadState: "SKIPPED" })).toBe(false);
    expect(shouldPromptLead({ ...base, form, leadState: "CAPTURED" })).toBe(false);
    expect(shouldPromptLead({ ...base, form, alreadyLead: true })).toBe(false);
    expect(shouldPromptLead({ ...base, form: parseLeadForm({ enabled: false }) })).toBe(false);
  });
});

describe("UT-30 contact details typed in chat - FE-2", () => {
  it("UT-30.01 finds emails and phone numbers", () => {
    expect(extractContactDetails("you can mail me at Ayesha.K@Example.com thanks")).toEqual({
      email: "ayesha.k@example.com",
      phone: null,
    });
    expect(extractContactDetails("call me on 0300 1234567 after 5").phone).toBe("+923001234567");
    expect(extractContactDetails("my number is +44 20 7946 0958").phone).toBe("+442079460958");
  });

  it("UT-30.02 does not mistake order numbers or dates for phones", () => {
    expect(extractContactDetails("order #1042 placed on 2026-09-29").phone).toBeNull();
    expect(extractContactDetails("invoice 458103").phone).toBeNull();
  });
});

describe("UT-31 lead score", () => {
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

  it("UT-31.01 scores a lead with only an email at 20", () => {
    expect(computeLeadScore({ ...empty, hasEmail: true })).toBe(20);
  });

  it("UT-31.02 scores a lead with every signal at 100", () => {
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

  it("UT-31.03 maps a score of 75 to hot", () => {
    expect(leadTemperature(75)).toBe("HOT");
  });

  it("UT-31.04 maps a score of 40 to warm", () => {
    expect(leadTemperature(40)).toBe("WARM");
  });

  it("UT-31.05 maps a score of 39 to cold", () => {
    expect(leadTemperature(39)).toBe("COLD");
  });
});

describe("UT-32 export and webhooks - FE-4", () => {
  it("UT-32.01 quotes CSV cells and defuses spreadsheet formulas", () => {
    expect(csvCell('Khan, "Ali"')).toBe('"Khan, ""Ali"""');
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+923001234567")).toBe("'+923001234567");
    expect(csvCell(null)).toBe("");
  });

  it("UT-32.02 signs payloads so receivers can verify them", () => {
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
