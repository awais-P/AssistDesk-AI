import { NextResponse } from "next/server";
import { requirePermission } from "@/src/lib/access";
import { userActor } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import { ConnectorError, type ConnectorProviderKey, connectConnector, serializeConnector } from "@/src/lib/connectors";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

/** Module 11 FE-1: HubSpot (CRM) and Shopify (e-commerce) connections. */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "connectors.manage", request);

  if (forbidden) {
    return forbidden;
  }

  const rows = await prisma.connector.findMany({ where: { workspaceId: session.user.workspaceId } });
  const find = (provider: ConnectorProviderKey) => rows.find((row) => row.provider === provider) ?? null;
  const [unsynced, synced] = await Promise.all([
    prisma.lead.count({ where: { workspaceId: session.user.workspaceId, crmSyncedAt: null, OR: [{ email: { not: null } }, { phone: { not: null } }] } }),
    prisma.lead.count({ where: { workspaceId: session.user.workspaceId, crmId: { not: null } } }),
  ]);

  return NextResponse.json({
    hubspot: { ...serializeConnector(find("HUBSPOT"), "HUBSPOT"), leadsInCrm: synced, leadsNotSynced: unsynced },
    shopify: serializeConnector(find("SHOPIFY"), "SHOPIFY"),
  });
}

/** Connects (or reconnects) a provider after testing the token. */
export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "connectors.manage", request);

  if (forbidden) {
    return forbidden;
  }

  const body = (await request.json().catch(() => ({}))) as { provider?: unknown; token?: unknown; shopDomain?: unknown; autoSync?: unknown };

  if (body.provider !== "HUBSPOT" && body.provider !== "SHOPIFY") {
    return NextResponse.json({ error: "Choose HubSpot or Shopify." }, { status: 400 });
  }

  if (typeof body.token !== "string") {
    return NextResponse.json({ error: "Paste the access token." }, { status: 400 });
  }

  try {
    const row = await connectConnector({
      workspaceId: session.user.workspaceId,
      provider: body.provider,
      token: body.token,
      shopDomain: body.shopDomain,
      autoSync: body.autoSync !== false,
      actor: { ...userActor(session.user), id: session.user.id },
      request,
    });
    return NextResponse.json({ connector: serializeConnector(row, body.provider) });
  } catch (error) {
    if (error instanceof ConnectorError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
