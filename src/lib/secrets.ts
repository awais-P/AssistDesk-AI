import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ENCRYPTED_PREFIX = "enc:v1:";
const DEV_FALLBACK_SECRET = "assistdesk-local-development-secret";

let warnedAboutFallback = false;

function getMasterSecret() {
  const configured = process.env.ASSISTDESK_ENCRYPTION_KEY?.trim();

  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ASSISTDESK_ENCRYPTION_KEY must be set in production to store API keys and integration secrets.",
    );
  }

  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      "[secrets] ASSISTDESK_ENCRYPTION_KEY is not set; using the local development key.",
    );
  }

  return DEV_FALLBACK_SECRET;
}

function deriveKey(purpose: string) {
  return createHash("sha256").update(`${purpose}:${getMasterSecret()}`).digest();
}

export function isEncryptedSecret(value: string | null | undefined) {
  return Boolean(value?.startsWith(ENCRYPTED_PREFIX));
}

export function encryptSecret(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (isEncryptedSecret(trimmed)) {
    return trimmed;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("secret-storage"), iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString("base64url")}`;
}

/**
 * Returns the plaintext secret. Values stored before encryption was added are
 * returned unchanged so older rows keep working until they are re-saved.
 */
export function decryptSecret(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  if (!isEncryptedSecret(value)) {
    return value;
  }

  try {
    const payload = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), "base64url");
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey("secret-storage"),
      iv,
    );
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    console.error("[secrets] Unable to decrypt a stored secret. Was the encryption key changed?");
    return null;
  }
}

export function maskSecret(value: string | null | undefined) {
  const plain = decryptSecret(value);

  if (!plain) {
    return null;
  }

  if (plain.length <= 8) {
    return "••••••••";
  }

  return `${plain.slice(0, 4)}••••${plain.slice(-4)}`;
}

export function signPayload(purpose: string, payload: string) {
  return createHmac("sha256", deriveKey(purpose)).update(payload).digest("base64url");
}

export function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function generateToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}
