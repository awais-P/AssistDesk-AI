import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { requirePermission } from "@/src/lib/access";
import { auditUser, userActor } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import { ConnectorError, type ConnectorProviderKey, disconnectConnector, findShopifyOrder, syncPendingLeads } from "@/src/lib/connectors";
import { prisma } from "@/src/lib/prisma";

type RouteContext = { params: Promise<{ provider: string }> };

function providerFrom(value: string): ConnectorProviderKey | null {
  const upper = value.toUpperCase();
  return upper === "HUBSPOT" || upper === "SHOPIFY" ? upper : null;
}

type Authorized = { session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>; provider: ConnectorProviderKey; response?: undefined };

async function authorize(request: Request, context: RouteContext): Promise<Authorized | { response: Response }> {
  const session = await getCurrentSession();

  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }

  const forbidden = requirePermission(session.user, "connectors.manage", request);

  if (forbidden) {
    return { response: forbidden };
  }

  const provider = providerFrom((await context.params).provider);

  if (!provider) {
    return { response: NextResponse.json({ error: "Unknown connector." }, { status: 404 }) };
  }

  return { session, provider };
}

/**
 * Actions on a connector: `sync` (HubSpot: push leads now), `lookup` (Shopify: try an
 * order lookup as the AI would) and `settings` (HubSpot automatic sync on/off).
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await authorize(request, context);

  if (auth.response) {
    return auth.response;
  }

  const { session, provider } = auth;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; autoSync?: unknown; orderNumber?: unknown; email?: unknown };

  try {
    if (body.action === "sync" && provider === "HUBSPOT") {
      const result = await syncPendingLeads(session.user.workspaceId);
      await auditUser(session.user, { action: "connector.synced", category: "integrations", summary: `${session.user.fullName} synced ${result.synced} lead(s) to HubSpot`, request });
      return NextResponse.json(result);
    }

    if (body.action === "lookup" && provider === "SHOPIFY") {
      const result = await findShopifyOrder(session.user.workspaceId, {
        orderNumber: typeof body.orderNumber === "string" ? body.orderNumber : "",
        email: typeof body.email === "string" && body.email.trim() ? body.email.trim() : null,
        phone: null,
      });
      return NextResponse.json({ result });
    }

    if (body.action === "settings" && provider === "HUBSPOT" && typeof body.autoSync === "boolean") {
      const row = await prisma.connector.findUnique({ where: { workspaceId_provider: { workspaceId: session.user.workspaceId, provider } } });
      if (!row) {
        return NextResponse.json({ error: "HubSpot is not connected." }, { status: 409 });
      }
      await prisma.connector.update({
        where: { id: row.id },
        data: { config: { ...((row.config ?? {}) as Record<string, unknown>), autoSync: body.autoSync } as Prisma.InputJsonValue },
        select: { id: true },
      });
      await auditUser(session.user, { action: "connector.updated", category: "integrations", summary: `${session.user.fullName} turned automatic HubSpot sync ${body.autoSync ? "on" : "off"}`, request });
      return NextResponse.json({ autoSync: body.autoSync });
    }
  } catch (error) {
    if (error instanceof ConnectorError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  return NextResponse.json({ error: "Unknown action for this connector." }, { status: 400 });
}

/** Disconnects: the token is deleted at once. */
export async function DELETE(request: Request, context: RouteContext) {
  const auth = await authorize(request, context);

  if (auth.response) {
    return auth.response;
  }

  const removed = await disconnectConnector(auth.session.user.workspaceId, auth.provider, userActor(auth.session.user), request);
  return removed ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Not connected." }, { status: 404 });
}
