import type { Prisma } from "@/app/generated/prisma/client";
import { decryptSecret, encryptSecret, maskSecret } from "../secrets";

type ChannelType = "EMAIL" | "WHATSAPP" | "SLACK" | "VOICE";

const secretFieldsByType: Record<ChannelType, string[]> = {
  EMAIL: [],
  VOICE: [],
  SLACK: ["botToken", "signingSecret"],
  WHATSAPP: ["accessToken", "appSecret"],
};

const plainFieldsByType: Record<ChannelType, string[]> = {
  EMAIL: [],
  VOICE: [],
  SLACK: ["botUserId", "teamName"],
  WHATSAPP: ["phoneNumberId", "displayPhoneNumber", "verifiedName"],
};

export type IntegrationConfigRecord = Record<string, string>;

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Merges submitted config with the stored one. Secret fields are encrypted; a blank
 * secret keeps the stored value so admins do not have to re-enter tokens on edit.
 */
export function mergeIntegrationConfig(
  type: ChannelType,
  incoming: Record<string, unknown> | null | undefined,
  stored: Prisma.JsonValue | null | undefined,
): Record<string, unknown> {
  const current = asRecord(stored);
  const next: Record<string, unknown> = { ...current };
  const submitted = incoming ?? {};

  for (const field of secretFieldsByType[type]) {
    const value = typeof submitted[field] === "string" ? (submitted[field] as string).trim() : "";

    if (value) {
      next[field] = encryptSecret(value);
    }
  }

  for (const field of plainFieldsByType[type]) {
    const value = typeof submitted[field] === "string" ? (submitted[field] as string).trim() : "";

    if (value) {
      next[field] = value;
    }
  }

  if (type === "EMAIL" || type === "VOICE") {
    for (const [key, value] of Object.entries(submitted)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        next[key] = value;
      }
    }
  }

  return next;
}

/** Server-side only: returns config with secrets decrypted. */
export function readIntegrationConfig(
  type: ChannelType,
  stored: Prisma.JsonValue | null | undefined,
): IntegrationConfigRecord {
  const current = asRecord(stored);
  const result: IntegrationConfigRecord = {};

  for (const [key, value] of Object.entries(current)) {
    if (typeof value !== "string") {
      continue;
    }

    result[key] = secretFieldsByType[type].includes(key) ? decryptSecret(value) ?? "" : value;
  }

  return result;
}

/** Client-safe config: secrets replaced with masked previews. */
export function maskIntegrationConfig(
  type: ChannelType,
  stored: Prisma.JsonValue | null | undefined,
) {
  const current = asRecord(stored);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(current)) {
    if (secretFieldsByType[type].includes(key)) {
      result[key] = typeof value === "string" ? maskSecret(value) : null;
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function missingSecretFields(type: ChannelType, config: IntegrationConfigRecord) {
  return secretFieldsByType[type].filter((field) => !config[field]);
}
