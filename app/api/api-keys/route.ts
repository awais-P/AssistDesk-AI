import { NextResponse } from "next/server";
import { requirePermission } from "@/src/lib/access";
import { MAX_API_KEYS, generateApiKey, parseApiKeyInput } from "@/src/lib/api-keys";
import { auditUser } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

const select = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  usageCount: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  createdBy: { select: { fullName: true } },
} as const;

/** Module 11 FE-2: the workspace's API keys (never the keys themselves). */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "apikeys.manage", request);

  if (forbidden) {
    return forbidden;
  }

  const keys = await prisma.apiKey.findMany({
    where: { workspaceId: session.user.workspaceId },
    select,
    orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
  });

  return NextResponse.json({ keys });
}

/** Creates a key. The full key is returned only in this response. */
export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "apikeys.manage", request);

  if (forbidden) {
    return forbidden;
  }

  const parsed = parseApiKeyInput((await request.json().catch(() => ({}))) as Record<string, unknown>);

  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const active = await prisma.apiKey.count({ where: { workspaceId: session.user.workspaceId, revokedAt: null } });

  if (active >= MAX_API_KEYS) {
    return NextResponse.json({ error: `Up to ${MAX_API_KEYS} active keys. Revoke one you no longer use.` }, { status: 400 });
  }

  const { key, prefix, keyHash } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: { workspaceId: session.user.workspaceId, name: parsed.value.name, prefix, keyHash, scopes: parsed.value.scopes, expiresAt: parsed.value.expiresAt, createdById: session.user.id },
    select,
  });

  await auditUser(session.user, {
    action: "api_key.created",
    category: "api",
    summary: `${session.user.fullName} created the API key "${created.name}" (${created.prefix}…)`,
    targetType: "api_key",
    targetId: created.id,
    metadata: { scopes: created.scopes, expiresAt: created.expiresAt?.toISOString() ?? null },
    request,
  });

  return NextResponse.json({ key: created, secret: key }, { status: 201 });
}
