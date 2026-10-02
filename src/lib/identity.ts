/**
 * Customer identity normalisation (Module 5 FE-2, Module 8 FE-2). Pure functions with
 * no database access, so the widget and lead forms can use them in the browser too.
 */

export type ChannelKind = "WEB_WIDGET" | "WHATSAPP" | "SLACK" | "EMAIL" | "VOICE";

export type ContactIdentity = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsappId?: string | null;
  slackUserId?: string | null;
  visitorId?: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase();
  return email && EMAIL_PATTERN.test(email) ? email : null;
}

function defaultCountryCode() {
  return (process.env.ASSISTDESK_DEFAULT_COUNTRY_CODE || "92").replace(/\D/g, "");
}

/**
 * Normalises to E.164 ("+923001234567") so the same number typed in the widget
 * ("0300-1234567") and received from WhatsApp ("923001234567") match. National
 * numbers with a leading 0 use ASSISTDESK_DEFAULT_COUNTRY_CODE (default 92, Pakistan).
 */
export function normalizePhone(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  let digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("00")) {
    digits = digits.slice(2);
  } else if (!trimmed.startsWith("+") && digits.startsWith("0")) {
    digits = `${defaultCountryCode()}${digits.slice(1)}`;
  }

  if (digits.length < 8 || digits.length > 15) {
    return null;
  }

  return `+${digits}`;
}

/** WhatsApp ids are the full international number without "+" (e.g. 923001234567). */
export function whatsappIdToPhone(waId: string) {
  const digits = waId.replace(/\D/g, "");
  return digits ? normalizePhone(`+${digits}`) : null;
}

export function normalizeVisitorId(value: string | null | undefined) {
  const id = value?.trim();
  return id && /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
}

export function normalizeIdentity(identity: ContactIdentity): ContactIdentity {
  const phone = normalizePhone(identity.phone);
  const whatsappId = identity.whatsappId?.replace(/\D/g, "") || null;

  return {
    name: identity.name?.trim().slice(0, 120) || null,
    email: normalizeEmail(identity.email),
    // A WhatsApp id is a verified phone number, so it doubles as the contact's phone.
    phone: phone ?? (whatsappId ? whatsappIdToPhone(whatsappId) : null),
    whatsappId,
    slackUserId: identity.slackUserId?.trim() || null,
    visitorId: normalizeVisitorId(identity.visitorId),
  };
}

export function hasAnyIdentifier(identity: ContactIdentity) {
  return Boolean(
    identity.email || identity.phone || identity.whatsappId || identity.slackUserId || identity.visitorId,
  );
}
