import type { Prisma } from "@/app/generated/prisma/client";
import { type AuditActor, recordAudit } from "./audit";
import { createNotification } from "./notifications";
import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./secrets";

/**
 * Module 11 FE-1: connectors to third-party systems.
 * - HubSpot (CRM): leads are pushed to HubSpot contacts automatically (and on demand),
 *   with the HubSpot record id kept on the lead.
 * - Shopify (e-commerce): the AI's `shopify_order_status` action looks up a customer's
 *   order, only after the customer's email or phone matches the order.
 * Tokens are stored encrypted (AES-256-GCM) and never returned to the browser. Only the
 * fixed vendor hosts are called (a Shopify store must be a *.myshopify.com domain).
 */

export type ConnectorProviderKey = "HUBSPOT" | "SHOPIFY";
export const HUBSPOT_API = "https://api.hubapi.com";
export const SHOPIFY_API_VERSION = "2024-10";
const TIMEOUT_MS = 10_000;

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly authFailed = false,
  ) {
    super(message);
  }
}

export function normalizeShopDomain(input: unknown) {
  if (typeof input !== "string") return null;
  const cleaned = input.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  const domain = cleaned.includes(".") ? cleaned : `${cleaned}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(domain) ? domain : null;
}

async function vendorFetch(url: string, init: RequestInit) {
  let response: Response;

  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  } catch {
    throw new ConnectorError("The service could not be reached. Try again in a moment.", 502);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ConnectorError(
      response.status === 401 ? "The access token was refused. Check it and connect again." : "The token is missing a permission (scope) this needs.",
      400,
      true,
    );
  }

  if (response.status === 429) {
    throw new ConnectorError("The service is rate limiting us. Try again in a minute.", 503);
  }

  if (!response.ok) {
    throw new ConnectorError(`The service answered with an error (${response.status}).`, 502);
  }

  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

// --------------------------------------------------------------------- HubSpot

const hubspotHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

export async function testHubSpot(token: string) {
  await vendorFetch(`${HUBSPOT_API}/crm/v3/objects/contacts?limit=1&properties=email`, { headers: hubspotHeaders(token) });
  return { name: "HubSpot CRM" };
}

const hubspotLeadStatus: Record<string, string | undefined> = {
  NEW: "NEW",
  CONTACTED: "ATTEMPTED_TO_CONTACT",
  QUALIFIED: "OPEN_DEAL",
  LOST: "UNQUALIFIED",
};

export function hubspotProperties(lead: { name: string | null; email: string | null; phone: string | null; company: string | null; status: string }) {
  const [firstname, ...rest] = (lead.name ?? "").trim().split(/\s+/);
  const properties: Record<string, string> = {};
  if (lead.email) properties.email = lead.email;
  if (firstname) properties.firstname = firstname;
  if (rest.length) properties.lastname = rest.join(" ");
  if (lead.phone) properties.phone = lead.phone;
  if (lead.company) properties.company = lead.company;
  const status = hubspotLeadStatus[lead.status];
  if (status) properties.hs_lead_status = status;
  return properties;
}

async function upsertHubSpotContact(token: string, lead: Parameters<typeof hubspotProperties>[0] & { crmId: string | null }) {
  const properties = hubspotProperties(lead);
  let id = lead.crmId;

  if (!id) {
    const property = lead.email ? "email" : "phone";
    const value = lead.email ?? lead.phone;
    const found = await vendorFetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: hubspotHeaders(token),
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: property, operator: "EQ", value }] }], properties: ["email"], limit: 1 }),
    });
    id = ((found.results as Array<{ id: string }> | undefined) ?? [])[0]?.id ?? null;
  }

  if (id) {
    await vendorFetch(`${HUBSPOT_API}/crm/v3/objects/contacts/${encodeURIComponent(id)}`, { method: "PATCH", headers: hubspotHeaders(token), body: JSON.stringify({ properties }) });
    return { id, created: false };
  }

  const created = await vendorFetch(`${HUBSPOT_API}/crm/v3/objects/contacts`, {
    method: "POST",
    headers: hubspotHeaders(token),
    body: JSON.stringify({ properties: { ...properties, lifecyclestage: "lead" } }),
  });
  return { id: String(created.id), created: true };
}

// --------------------------------------------------------------------- Shopify

const shopifyHeaders = (token: string) => ({ "X-Shopify-Access-Token": token, "Content-Type": "application/json" });

export async function testShopify(domain: string, token: string) {
  const body = await vendorFetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, { headers: shopifyHeaders(token) });
  return { name: String((body.shop as { name?: string } | undefined)?.name ?? domain) };
}

type ShopifyOrder = {
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  cancelled_at: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  total_price: string;
  currency: string;
  line_items?: Array<{ title: string; quantity: number }>;
  fulfillments?: Array<{ status: string; tracking_company: string | null; tracking_number: string | null; tracking_url: string | null; updated_at: string }>;
  customer?: { email?: string | null; phone?: string | null } | null;
};

const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/** The customer is who they say only if their email or phone matches the order. */
export function orderBelongsTo(order: Pick<ShopifyOrder, "email" | "phone" | "customer">, who: { email: string | null; phone: string | null }) {
  const emails = [order.email, order.customer?.email].filter(Boolean).map((value) => String(value).toLowerCase());
  const phones = [order.phone, order.customer?.phone].map(digits).filter((value) => value.length >= 7);
  if (who.email && emails.includes(who.email.toLowerCase())) return true;
  const phone = digits(who.phone);
  return phone.length >= 7 && phones.some((value) => value.slice(-9) === phone.slice(-9));
}

export function summarizeOrder(order: ShopifyOrder) {
  const tracking = (order.fulfillments ?? [])
    .filter((fulfillment) => fulfillment.tracking_number || fulfillment.tracking_url)
    .map((fulfillment) => ({ carrier: fulfillment.tracking_company, number: fulfillment.tracking_number, url: fulfillment.tracking_url, status: fulfillment.status }));
  return {
    order: order.name,
    placedOn: order.created_at.slice(0, 10),
    status: order.cancelled_at ? "cancelled" : order.fulfillment_status === "fulfilled" ? "shipped" : order.fulfillment_status === "partial" ? "partly shipped" : "not shipped yet",
    payment: order.financial_status,
    total: `${order.total_price} ${order.currency}`,
    items: (order.line_items ?? []).slice(0, 10).map((item) => `${item.quantity} × ${item.title}`),
    tracking,
  };
}

export async function findShopifyOrder(workspaceId: string, input: { orderNumber: string; email: string | null; phone: string | null }) {
  const connector = await loadConnector(workspaceId, "SHOPIFY");

  if (!connector?.token || !connector.shopDomain) {
    throw new ConnectorError("The online store is not connected.", 409);
  }

  const number = input.orderNumber.replace(/[^0-9A-Za-z-]/g, "").slice(0, 20);

  if (!number) {
    throw new ConnectorError("Ask the customer for their order number.");
  }

  const fields = "name,email,phone,created_at,cancelled_at,financial_status,fulfillment_status,total_price,currency,line_items,fulfillments,customer";
  const body = await vendorFetch(
    `https://${connector.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&limit=1&name=${encodeURIComponent(`#${number}`)}&fields=${fields}`,
    { headers: shopifyHeaders(connector.token) },
  ).catch(async (error) => {
    await markConnectorError(connector.id, workspaceId, error);
    throw error;
  });
  const order = ((body.orders as ShopifyOrder[] | undefined) ?? [])[0];

  if (!order) {
    return { found: false as const };
  }

  if (!orderBelongsTo(order, input)) {
    // Same answer as "not found": never confirm that someone else's order exists.
    return { found: false as const, needsVerification: !input.email && !input.phone };
  }

  return { found: true as const, ...summarizeOrder(order) };
}

/** A Shopify order with what refunds and invoices need (line items, totals, ids). */
export type ShopifyOrderDetail = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  cancelled_at: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  currency: string;
  subtotal_price: string;
  total_tax: string;
  total_price: string;
  line_items?: Array<{ id: number; title: string; quantity: number; price: string }>;
  customer?: { email?: string | null; phone?: string | null; first_name?: string | null; last_name?: string | null } | null;
};

/**
 * Module 2 FE-1: the customer's own Shopify order with its lines and totals (for refunds
 * and invoices). Like `findShopifyOrder`, it is returned only when the email or phone
 * matches the order; otherwise the answer is the same as "not found".
 */
export async function getShopifyOrderDetail(workspaceId: string, input: { orderNumber: string; email: string | null; phone: string | null }) {
  const connector = await loadConnector(workspaceId, "SHOPIFY");

  if (!connector?.token || !connector.shopDomain) {
    throw new ConnectorError("The online store is not connected.", 409);
  }

  const number = input.orderNumber.replace(/[^0-9A-Za-z-]/g, "").slice(0, 20);

  if (!number) {
    throw new ConnectorError("Ask the customer for their order number.");
  }

  const fields = "id,name,email,phone,created_at,cancelled_at,financial_status,fulfillment_status,currency,subtotal_price,total_tax,total_price,line_items,customer";
  const body = await vendorFetch(
    `https://${connector.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&limit=1&name=${encodeURIComponent(`#${number}`)}&fields=${fields}`,
    { headers: shopifyHeaders(connector.token) },
  ).catch(async (error) => {
    await markConnectorError(connector.id, workspaceId, error);
    throw error;
  });
  const order = ((body.orders as ShopifyOrderDetail[] | undefined) ?? [])[0];

  if (!order) {
    return { found: false as const, needsVerification: false };
  }

  if (!orderBelongsTo(order, input)) {
    return { found: false as const, needsVerification: !input.email && !input.phone };
  }

  return { found: true as const, order };
}

/**
 * Module 2 FE-1: refunds a Shopify order in full, after a team member approved it.
 * Shopify works out what can be refunded (items and shipping) and through which payment;
 * that suggestion is then created as the refund, and Shopify emails the customer.
 */
export async function refundShopifyOrder(workspaceId: string, orderId: string, note: string) {
  const connector = await loadConnector(workspaceId, "SHOPIFY");

  if (!connector?.token || !connector.shopDomain) {
    throw new ConnectorError("The online store is not connected.", 409);
  }

  const base = `https://${connector.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders/${encodeURIComponent(orderId)}`;
  const headers = shopifyHeaders(connector.token);

  try {
    const orderBody = await vendorFetch(`${base}.json?fields=id,line_items`, { headers });
    const lineItems = ((orderBody.order as { line_items?: Array<{ id: number; quantity: number }> } | undefined)?.line_items ?? []).map((item) => ({
      line_item_id: item.id,
      quantity: item.quantity,
      restock_type: "no_restock",
    }));
    const calculated = await vendorFetch(`${base}/refunds/calculate.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refund: { shipping: { full_refund: true }, refund_line_items: lineItems } }),
    });
    const suggestion = (calculated.refund as { transactions?: Array<{ parent_id: number; amount: string; gateway: string }> } | undefined)?.transactions ?? [];

    if (suggestion.length === 0) {
      throw new ConnectorError("Shopify found nothing left to refund on this order (it may already be refunded).", 409);
    }

    const created = await vendorFetch(`${base}/refunds.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        refund: {
          notify: true,
          note: note.slice(0, 250),
          shipping: { full_refund: true },
          refund_line_items: lineItems,
          transactions: suggestion.map((transaction) => ({
            parent_id: transaction.parent_id,
            amount: transaction.amount,
            kind: "refund",
            gateway: transaction.gateway,
          })),
        },
      }),
    });
    const refund = created.refund as { id?: number } | undefined;
    const amount = suggestion.reduce((total, transaction) => total + Number(transaction.amount || 0), 0);
    return { refundId: refund?.id ? String(refund.id) : null, amount };
  } catch (error) {
    // A token that can read orders but not refund them (no write_orders scope) is not a
    // broken connector: order lookups keep working, only this refund fails.
    if (error instanceof ConnectorError && error.authFailed && /permission/.test(error.message)) {
      throw new ConnectorError("The Shopify token can't create refunds. Give the app the write_orders permission, connect again, then retry.", 400);
    }

    if (!(error instanceof ConnectorError && error.status === 409)) {
      await markConnectorError(connector.id, workspaceId, error);
    }
    throw error;
  }
}

// ------------------------------------------------------------------ storage

type ConnectorConfig = { shopDomain?: string; autoSync?: boolean; accountName?: string };

export async function loadConnector(workspaceId: string, provider: ConnectorProviderKey) {
  const row = await prisma.connector.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });

  if (!row || row.status === "DISCONNECTED") {
    return null;
  }

  const config = (row.config ?? {}) as ConnectorConfig;
  return { ...row, token: decryptSecret(row.secret), shopDomain: config.shopDomain ?? null, autoSync: config.autoSync !== false };
}

export function serializeConnector(row: { id: string; provider: string; name: string; status: string; config: unknown; lastSyncedAt: Date | null; lastError: string | null; syncedCount: number; updatedAt: Date } | null, provider: ConnectorProviderKey) {
  const config = (row?.config ?? {}) as ConnectorConfig;
  return {
    provider,
    connected: Boolean(row && row.status !== "DISCONNECTED"),
    id: row?.id ?? null,
    name: row?.name ?? null,
    status: row?.status ?? "DISCONNECTED",
    shopDomain: config.shopDomain ?? null,
    autoSync: config.autoSync !== false,
    lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    syncedCount: row?.syncedCount ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function connectConnector(input: {
  workspaceId: string;
  provider: ConnectorProviderKey;
  token: string;
  shopDomain?: unknown;
  autoSync?: boolean;
  actor: AuditActor & { id: string };
  request?: Request | null;
}) {
  const token = input.token.trim();

  if (token.length < 10 || token.length > 500 || /\s/.test(token)) {
    throw new ConnectorError("Paste the full access token.");
  }

  let config: ConnectorConfig;
  let name: string;

  if (input.provider === "SHOPIFY") {
    const shopDomain = normalizeShopDomain(input.shopDomain);
    if (!shopDomain) {
      throw new ConnectorError("Enter your store's Shopify address, e.g. kettle-store.myshopify.com.");
    }
    name = (await testShopify(shopDomain, token)).name;
    config = { shopDomain, accountName: name };
  } else {
    name = (await testHubSpot(token)).name;
    config = { autoSync: input.autoSync !== false, accountName: name };
  }

  const data = { name, status: "CONNECTED" as const, secret: encryptSecret(token), config: config as Prisma.InputJsonValue, lastError: null, createdById: input.actor.id };
  const row = await prisma.connector.upsert({
    where: { workspaceId_provider: { workspaceId: input.workspaceId, provider: input.provider } },
    create: { workspaceId: input.workspaceId, provider: input.provider, ...data },
    update: data,
  });

  if (input.provider === "SHOPIFY") {
    await enableShopifyActionForAgents(input.workspaceId);
  }

  await recordAudit({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "connector.connected",
    category: "integrations",
    summary: `${input.actor.name} connected ${input.provider === "SHOPIFY" ? `Shopify (${config.shopDomain})` : "HubSpot"}`,
    targetType: "connector",
    targetId: row.id,
    request: input.request,
  });

  return row;
}

/** The order-status action is turned on for every agent that uses actions. */
async function enableShopifyActionForAgents(workspaceId: string) {
  const { ensureBuiltInTools } = await import("./tools/registry");
  await ensureBuiltInTools(workspaceId);
  const tool = await prisma.agentTool.findFirst({ where: { workspaceId, builtInKey: "shopify_order_status" }, select: { id: true } });
  if (!tool) return;
  const agents = await prisma.aIAgent.findMany({ where: { workspaceId }, select: { id: true } });
  await prisma.agentToolBinding.createMany({ data: agents.map((agent) => ({ agentId: agent.id, toolId: tool.id })), skipDuplicates: true });
}

export async function disconnectConnector(workspaceId: string, provider: ConnectorProviderKey, actor: AuditActor, request?: Request | null) {
  const row = await prisma.connector.findUnique({ where: { workspaceId_provider: { workspaceId, provider } }, select: { id: true } });

  if (!row) {
    return false;
  }

  await prisma.connector.update({ where: { id: row.id }, data: { status: "DISCONNECTED", secret: null, lastError: null }, select: { id: true } });
  await recordAudit({ workspaceId, actor, action: "connector.disconnected", category: "integrations", summary: `${actor.name} disconnected ${provider === "SHOPIFY" ? "Shopify" : "HubSpot"}`, targetType: "connector", targetId: row.id, request });
  return true;
}

async function markConnectorError(id: string, workspaceId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const authFailed = error instanceof ConnectorError && error.authFailed;
  await prisma.connector.update({ where: { id }, data: { lastError: message.slice(0, 300), ...(authFailed ? { status: "ERROR" } : {}) }, select: { id: true } });

  if (authFailed) {
    await createNotification({
      workspaceId,
      type: "INTEGRATION_ERROR",
      severity: "ERROR",
      title: "A connector stopped working",
      body: message,
      link: "/dashboard/connectors",
      dedupeMinutes: 60,
    });
  }
}

// ------------------------------------------------------------------ lead sync

/** Pushes one lead to HubSpot. Returns false when there is nothing to do. */
export async function syncLeadToCrm(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, workspaceId: true, name: true, email: true, phone: true, company: true, status: true, crmId: true } });

  if (!lead || (!lead.email && !lead.phone)) {
    return false;
  }

  const connector = await loadConnector(lead.workspaceId, "HUBSPOT");

  if (!connector?.token || connector.status === "ERROR") {
    return false;
  }

  try {
    const result = await upsertHubSpotContact(connector.token, lead);
    // One statement so crmSyncedAt equals updatedAt: "changed since the last sync" stays exact.
    await prisma.$executeRaw`UPDATE "Lead" SET "crmId" = ${result.id}, "crmSyncedAt" = NOW(), "updatedAt" = NOW() WHERE "id" = ${lead.id}`;
    await prisma.connector.update({
      where: { id: connector.id },
      data: { lastSyncedAt: new Date(), lastError: null, ...(result.created ? { syncedCount: { increment: 1 } } : {}) },
      select: { id: true },
    });
    return true;
  } catch (error) {
    await markConnectorError(connector.id, lead.workspaceId, error);
    throw error;
  }
}

/** Automatic sync after a lead is captured or changed (when HubSpot auto-sync is on). */
export function scheduleLeadCrmSync(leadId: string, workspaceId: string) {
  setTimeout(() => {
    void (async () => {
      const connector = await loadConnector(workspaceId, "HUBSPOT");
      if (connector?.autoSync) {
        await syncLeadToCrm(leadId);
      }
    })().catch((error) => console.error("[connectors] Lead sync failed:", error instanceof Error ? error.message : error));
  }, 0);
}

/** "Sync now": every lead not yet in the CRM, or changed since its last sync. */
export async function syncPendingLeads(workspaceId: string, limit = 100) {
  const connector = await loadConnector(workspaceId, "HUBSPOT");

  if (!connector?.token) {
    throw new ConnectorError("HubSpot is not connected.", 409);
  }

  const leads = await prisma.lead.findMany({
    where: { workspaceId, OR: [{ email: { not: null } }, { phone: { not: null } }], AND: [{ OR: [{ crmSyncedAt: null }, { updatedAt: { gt: prisma.lead.fields.crmSyncedAt } }] }] },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let synced = 0;

  for (const lead of leads) {
    if (await syncLeadToCrm(lead.id)) {
      synced += 1;
    }
  }

  return { synced, remaining: Math.max(0, leads.length - synced) };
}
