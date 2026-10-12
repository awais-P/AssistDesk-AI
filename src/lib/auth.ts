import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import {
  RATE_LIMITS,
  consumeRateLimit,
  getRequestIp,
  hashClientIp,
  peekRateLimit,
  resetRateLimit,
} from "./rate-limit";

export const AUTH_COOKIE_NAME = "assistdesk_session";
export const MIN_PASSWORD_LENGTH = 8;

const BCRYPT_ROUNDS = 12;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value);
}

export function validateNewPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }

  return null;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function legacySha256(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

/**
 * Verifies a password. bcrypt hashes are the current format; unsalted SHA-256
 * hashes from the first milestone still verify once and are flagged for re-hashing.
 * Plaintext comparison is never done.
 */
export async function verifyPassword(password: string, hash: string | null) {
  if (!hash) {
    return { valid: false, needsRehash: false };
  }

  if (hash.startsWith("$2")) {
    return { valid: await bcrypt.compare(password, hash), needsRehash: false };
  }

  if (/^[a-f0-9]{64}$/.test(hash)) {
    const candidate = Buffer.from(legacySha256(password));
    const stored = Buffer.from(hash);

    return {
      valid: candidate.length === stored.length && timingSafeEqual(candidate, stored),
      needsRehash: true,
    };
  }

  return { valid: false, needsRehash: false };
}

export function generateTemporaryPassword() {
  // Readable but strong: 4 groups of 4 characters plus a digit guarantee.
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  const groups = [0, 4, 8, 12].map((start) =>
    Array.from(bytes.subarray(start, start + 4), (byte) => alphabet[byte % alphabet.length]).join(""),
  );

  return `${groups.join("-")}-${(bytes[0] % 10).toString()}`;
}

export function createSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function createUsernameFromEmail(email: string) {
  return createSlug(email.split("@")[0] || "user");
}

export async function createUniqueWorkspaceSlug(base: string) {
  let slug = createSlug(base) || "assistdesk-workspace";
  let counter = 1;

  while (
    await prisma.workspace.findUnique({
      where: { slug },
      select: { id: true },
    })
  ) {
    counter += 1;
    slug = `${createSlug(base) || "assistdesk-workspace"}-${counter}`;
  }

  return slug;
}

export async function createUniqueUsername(base: string) {
  let username = createSlug(base) || "user";
  let counter = 1;

  while (
    await prisma.user.findUnique({
      where: { username },
      select: { id: true },
    })
  ) {
    counter += 1;
    username = `${createSlug(base) || "user"}${counter}`;
  }

  return username;
}

/** Session tokens are stored hashed, so a database leak does not expose live sessions. */
export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      token: hashSessionToken(token),
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

export const getCurrentSession = cache(async function getCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({
    where: { token: tokenHash },
    include: {
      user: true,
    },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt <= new Date() || !session.user.isActive) {
    await prisma.session.deleteMany({
      where: { token: tokenHash },
    });

    return null;
  }

  return session;
});

export async function clearCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return;
  }

  await prisma.session.deleteMany({
    where: { token: hashSessionToken(token) },
  });
}

/** Signs a user out everywhere except (optionally) the current device. */
export async function revokeUserSessions(userId: string, keepToken?: string | null) {
  await prisma.session.deleteMany({
    where: {
      userId,
      ...(keepToken ? { token: { not: hashSessionToken(keepToken) } } : {}),
    },
  });
}

function loginRateLimitKeys(identifier: string, request: Request) {
  // Keys are hashed so the limiter table never stores emails or IP addresses.
  return {
    identifier: `login-id:${hashClientIp(`id:${identifier}`)}`,
    ip: `login-ip:${hashClientIp(getRequestIp(request))}`,
  };
}

/**
 * Brute-force protection (SEC-30, Module 5 FE-6): 5 failed attempts per account and
 * 30 per IP address in 10 minutes. Counters live in PostgreSQL (RateLimitBucket), so
 * they hold across server instances and restarts. Returns seconds to wait, or 0.
 */
export async function checkLoginRateLimit(identifier: string, request: Request) {
  const keys = loginRateLimitKeys(identifier, request);
  const [byIdentifier, byIp] = await Promise.all([
    peekRateLimit(keys.identifier, RATE_LIMITS.loginPerIdentifier),
    peekRateLimit(keys.ip, RATE_LIMITS.loginPerIp),
  ]);
  const blocked = [
    byIdentifier.count >= RATE_LIMITS.loginPerIdentifier.limit ? byIdentifier.retryAfterSeconds : 0,
    byIp.count >= RATE_LIMITS.loginPerIp.limit ? byIp.retryAfterSeconds : 0,
  ];

  return Math.max(...blocked);
}

export async function recordFailedLogin(identifier: string, request: Request) {
  const keys = loginRateLimitKeys(identifier, request);

  await Promise.all([
    consumeRateLimit(keys.identifier, RATE_LIMITS.loginPerIdentifier),
    consumeRateLimit(keys.ip, RATE_LIMITS.loginPerIp),
  ]);
}

/** A successful sign-in clears the account's counter (not the IP's). */
export async function clearFailedLogins(identifier: string, request: Request) {
  await resetRateLimit(loginRateLimitKeys(identifier, request).identifier);
}
