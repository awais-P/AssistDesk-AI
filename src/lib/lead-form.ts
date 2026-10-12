import { normalizeEmail, normalizePhone } from "./identity";

/**
 * Module 8 lead capture: the per-chatbot form (FE-1), validation, when to show it,
 * buying-intent detection, contact details typed in chat (FE-2) and lead scoring.
 * Pure functions, shared by the server, the widget and the chatbot form builder.
 */

export type LeadFieldType = "text" | "email" | "phone" | "textarea" | "select" | "number";

export type LeadFormField = {
  key: string;
  label: string;
  type: LeadFieldType;
  required: boolean;
  placeholder?: string;
  options?: string[];
};

/**
 * FIRST_MESSAGE: right after the visitor's first message.
 * AFTER_MESSAGES: after N visitor messages.
 * ON_INTENT: when the visitor shows buying intent (pricing, quote, demo…).
 */
export type LeadTrigger = "FIRST_MESSAGE" | "AFTER_MESSAGES" | "ON_INTENT";

export type LeadFormConfig = {
  enabled: boolean;
  title: string;
  description: string;
  submitLabel: string;
  successMessage: string;
  trigger: LeadTrigger;
  afterMessages: number;
  allowSkip: boolean;
  /** When set, a marketing-consent checkbox with this text is shown (unticked). */
  consentText: string | null;
  fields: LeadFormField[];
};

export const LEAD_FIELD_TYPES: LeadFieldType[] = ["text", "email", "phone", "textarea", "select", "number"];
export const LEAD_TRIGGERS: Array<{ value: LeadTrigger; label: string; description: string }> = [
  {
    value: "ON_INTENT",
    label: "When the visitor shows buying intent",
    description: "Asks about prices, quotes, plans, demos, bulk orders or wants to talk to sales.",
  },
  {
    value: "AFTER_MESSAGES",
    label: "After a number of messages",
    description: "Once the visitor has sent this many messages in the conversation.",
  },
  {
    value: "FIRST_MESSAGE",
    label: "After the first message",
    description: "Right after the visitor's first message, before the AI answers it.",
  },
];

/** Built-in field keys map to Lead columns; any other key is a custom answer. */
export const BUILT_IN_LEAD_FIELDS = ["name", "email", "phone", "company"] as const;
export const MAX_LEAD_FIELDS = 8;
export const MAX_SELECT_OPTIONS = 12;

export const DEFAULT_LEAD_FORM: LeadFormConfig = {
  enabled: false,
  title: "Can our team follow up with you?",
  description: "Leave your details and we'll get back to you with the right answer.",
  submitLabel: "Send",
  successMessage: "Thanks{name}! Our team will be in touch soon.",
  trigger: "ON_INTENT",
  afterMessages: 3,
  allowSkip: true,
  consentText: "Send me offers and product updates",
  fields: [
    { key: "name", label: "Name", type: "text", required: true, placeholder: "Your name" },
    { key: "email", label: "Email", type: "email", required: true, placeholder: "you@company.com" },
    { key: "phone", label: "Phone", type: "phone", required: false, placeholder: "+92 300 1234567" },
  ],
};

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sanitizeKey(value: unknown) {
  const key = text(value, 40)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+/, "");
  return /^[a-z][a-z0-9_]{0,31}$/.test(key) ? key : null;
}

function sanitizeField(raw: unknown): LeadFormField | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const item = raw as Record<string, unknown>;
  const key = sanitizeKey(item.key);
  const type = LEAD_FIELD_TYPES.includes(item.type as LeadFieldType) ? (item.type as LeadFieldType) : "text";
  const label = text(item.label, 60);

  if (!key || !label) {
    return null;
  }

  const field: LeadFormField = {
    key,
    label,
    // Built-in keys always keep their natural type.
    type: key === "email" ? "email" : key === "phone" ? "phone" : type,
    required: item.required === true,
  };
  const placeholder = text(item.placeholder, 80);

  if (placeholder) {
    field.placeholder = placeholder;
  }

  if (field.type === "select") {
    const options = Array.isArray(item.options)
      ? [...new Set(item.options.map((option) => text(option, 60)).filter(Boolean))].slice(0, MAX_SELECT_OPTIONS)
      : [];

    if (options.length < 2) {
      field.type = "text";
    } else {
      field.options = options;
    }
  }

  return field;
}

/**
 * Turns stored or submitted JSON into a safe form config. A form always has a way to
 * reach the person: if it has neither an email nor a phone field, an email field is added.
 */
export function parseLeadForm(raw: unknown): LeadFormConfig {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_LEAD_FORM, fields: DEFAULT_LEAD_FORM.fields.map((field) => ({ ...field })) };
  }

  const value = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const fields = (Array.isArray(value.fields) ? value.fields : [])
    .map(sanitizeField)
    .filter((field): field is LeadFormField => {
      if (!field || seen.has(field.key)) {
        return false;
      }

      seen.add(field.key);
      return true;
    })
    .slice(0, MAX_LEAD_FIELDS);

  if (!fields.some((field) => field.key === "email" || field.key === "phone")) {
    fields.unshift({ key: "email", label: "Email", type: "email", required: true, placeholder: "you@company.com" });
  }

  const afterMessages = Number(value.afterMessages);
  const consentText = value.consentText === null ? null : text(value.consentText, 160);

  return {
    enabled: value.enabled === true,
    title: text(value.title, 80) || DEFAULT_LEAD_FORM.title,
    description: text(value.description, 240),
    submitLabel: text(value.submitLabel, 30) || DEFAULT_LEAD_FORM.submitLabel,
    successMessage: text(value.successMessage, 240) || DEFAULT_LEAD_FORM.successMessage,
    trigger: LEAD_TRIGGERS.some((item) => item.value === value.trigger) ? (value.trigger as LeadTrigger) : "ON_INTENT",
    afterMessages: Number.isFinite(afterMessages) ? Math.min(20, Math.max(1, Math.round(afterMessages))) : 3,
    allowSkip: value.allowSkip !== false,
    consentText: consentText || null,
    fields: fields.slice(0, MAX_LEAD_FIELDS),
  };
}

export type LeadValues = {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  fields: Array<{ key: string; label: string; value: string }>;
};

export type LeadValidationResult =
  | { ok: true; values: LeadValues }
  | { ok: false; errors: Record<string, string> };

/** Validates a lead form submission (SRS: email format, required fields). */
export function validateLeadSubmission(form: LeadFormConfig, raw: Record<string, unknown>): LeadValidationResult {
  const errors: Record<string, string> = {};
  const values: LeadValues = { name: null, email: null, phone: null, company: null, fields: [] };

  for (const field of form.fields) {
    const max = field.type === "textarea" ? 1000 : 200;
    const input = text(raw[field.key], max);

    if (!input) {
      if (field.required) {
        errors[field.key] = `${field.label} is required.`;
      }
      continue;
    }

    let value = input;

    if (field.type === "email") {
      const email = normalizeEmail(input);

      if (!email) {
        errors[field.key] = "Enter a valid email, like name@example.com.";
        continue;
      }

      value = email;
    } else if (field.type === "phone") {
      const phone = normalizePhone(input);

      if (!phone) {
        errors[field.key] = "Enter a valid phone number with country code, like +92 300 1234567.";
        continue;
      }

      value = phone;
    } else if (field.type === "number") {
      if (!/^-?\d+(\.\d+)?$/.test(input)) {
        errors[field.key] = `${field.label} must be a number.`;
        continue;
      }
    } else if (field.type === "select" && !field.options?.includes(input)) {
      errors[field.key] = `Choose one of the options for ${field.label}.`;
      continue;
    }

    if (field.key === "name" || field.key === "email" || field.key === "phone" || field.key === "company") {
      values[field.key] = value;
    } else {
      values.fields.push({ key: field.key, label: field.label, value });
    }
  }

  if (Object.keys(errors).length === 0 && !values.email && !values.phone) {
    const contactField = form.fields.find((field) => field.key === "email" || field.key === "phone");
    errors[contactField?.key ?? "email"] = "Leave an email or phone number so we can reach you.";
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** The form definition sent to the public widget (no internal settings). */
export function publicLeadForm(form: LeadFormConfig) {
  return form.enabled
    ? {
        title: form.title,
        description: form.description,
        submitLabel: form.submitLabel,
        allowSkip: form.allowSkip,
        consentText: form.consentText,
        fields: form.fields,
      }
    : null;
}

export type PublicLeadForm = NonNullable<ReturnType<typeof publicLeadForm>>;

export function formatSuccessMessage(form: LeadFormConfig, name: string | null) {
  return form.successMessage.replace("{name}", name ? `, ${name.split(/\s+/)[0]}` : "");
}

// Buying intent (FE-1 trigger, FE-2 on channels). English, Roman Urdu and Urdu.
const INTENT_PATTERNS: RegExp[] = [
  /\b(price|prices|pricing|cost|costs|how much|quote|quotation|estimate|rates?)\b/i,
  /\b(buy|purchase|order (some|a few|in bulk)|place an order|bulk|wholesale|reseller|distributor)\b/i,
  /\b(demo|free trial|trial|subscribe|subscription|plans?|packages?|upgrade|enterprise|license)\b/i,
  /\b(discount|offer|deal|promo|coupon)\b/i,
  /\b(talk to sales|sales team|contact sales|call me|call back|get in touch|interested in)\b/i,
  /\b(book|schedule) (a |an )?(call|demo|meeting|appointment|consultation)\b/i,
  /\b(kitne? ka|kitnay|kitni|qeemat|qimat|rate kya|price kya|kharid|khareed|lena hai|chahiye)\b/i,
  /(قیمت|خرید|ریٹ|پیکج)/,
];
const SUPPORT_ONLY =
  /\b(refund|cancel(led)? my|complain|complaint|not working|broken|damaged|where is my order|track(ing)? my|late delivery|wrong item)\b/i;

/** Returns the phrase that signals buying intent, or null. Complaints don't count. */
export function detectPurchaseIntent(message: string) {
  const content = message.slice(0, 2000);

  if (SUPPORT_ONLY.test(content)) {
    return null;
  }

  for (const pattern of INTENT_PATTERNS) {
    const match = content.match(pattern);

    if (match) {
      return match[0].toLowerCase();
    }
  }

  return null;
}

export function shouldPromptLead({
  form,
  leadState,
  customerMessageCount,
  message,
  alreadyLead,
}: {
  form: LeadFormConfig;
  leadState: string | null;
  customerMessageCount: number;
  message: string;
  alreadyLead: boolean;
}) {
  if (!form.enabled || leadState || alreadyLead) {
    return false;
  }

  if (form.trigger === "FIRST_MESSAGE") {
    return customerMessageCount >= 1;
  }

  if (form.trigger === "AFTER_MESSAGES") {
    return customerMessageCount >= form.afterMessages;
  }

  return Boolean(detectPurchaseIntent(message));
}

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_IN_TEXT = /(?:\+|00)?\d[\d\s().-]{8,16}\d/g;

/** Contact details a customer typed in a chat message (FE-2 "automatically collect"). */
export function extractContactDetails(message: string) {
  const email = normalizeEmail(message.match(EMAIL_IN_TEXT)?.[0] ?? null);
  let phone: string | null = null;

  for (const candidate of message.match(PHONE_IN_TEXT) ?? []) {
    // At least 10 digits, so order numbers and dates are not mistaken for phones.
    if (candidate.replace(/\D/g, "").length >= 10) {
      phone = normalizePhone(candidate);

      if (phone) {
        break;
      }
    }
  }

  return { email, phone };
}

export type LeadScoreInput = {
  hasEmail: boolean;
  hasPhone: boolean;
  hasName: boolean;
  hasCompany: boolean;
  customAnswers: number;
  buyingIntent: boolean;
  customerMessages: number;
  returningCustomer: boolean;
  marketingConsent: boolean;
};

/**
 * 0–100 priority for follow-up: reachable (email/phone), identified (name/company),
 * engaged (intent, messages, returning) and consent. Explained in the lead detail.
 */
export function computeLeadScore(input: LeadScoreInput) {
  let score = 0;

  if (input.hasEmail) score += 20;
  if (input.hasPhone) score += 15;
  if (input.hasName) score += 5;
  if (input.hasCompany) score += 10;
  score += Math.min(15, input.customAnswers * 5);
  if (input.buyingIntent) score += 20;
  if (input.customerMessages >= 4) score += 5;
  if (input.customerMessages >= 8) score += 5;
  if (input.returningCustomer) score += 10;
  if (input.marketingConsent) score += 5;

  return Math.min(100, score);
}

export type LeadTemperature = "HOT" | "WARM" | "COLD";

export function leadTemperature(score: number): LeadTemperature {
  return score >= 70 ? "HOT" : score >= 40 ? "WARM" : "COLD";
}

export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"] as const;
export type LeadStatusValue = (typeof LEAD_STATUSES)[number];

export const leadStatusLabels: Record<LeadStatusValue, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  CONVERTED: "Converted",
  LOST: "Lost",
};

/** Open leads are updated when the same customer comes back; closed ones start a new lead. */
export const OPEN_LEAD_STATUSES: LeadStatusValue[] = ["NEW", "CONTACTED", "QUALIFIED"];

export const leadSourceLabels: Record<string, string> = {
  FORM: "Lead form",
  AUTO: "Detected in chat",
  MANUAL: "Added by team",
  AI_TOOL: "AI assistant",
};
