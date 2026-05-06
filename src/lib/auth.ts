import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

export const AUTH_COOKIE_NAME = "assistdesk_session";

export function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

export function verifyPassword(password: string, hash: string | null) {
  if (!hash) {
    return false;
  }

  const hashedInput = hashPassword(password);

  return hash === hashedInput || hash === password;
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

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  await prisma.session.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { token },
    include: {
      user: true,
    },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt <= new Date() || !session.user.isActive) {
    await prisma.session.deleteMany({
      where: { token },
    });

    return null;
  }

  return session;
}

export async function clearCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return;
  }

  await prisma.session.deleteMany({
    where: { token },
  });
}
