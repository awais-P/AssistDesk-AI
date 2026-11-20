import { ConnectorError, getShopifyOrderDetail, loadConnector } from "./connectors";
import { isSampleStoreEnabled, sampleOrder } from "./sample-store";

/**
 * Module 2 FE-1: a customer's order in one shape, wherever it comes from:
 *   - SHOPIFY: the connected store (Module 11), returned only when the customer's email
 *     or phone matches the order;
 *   - SAMPLE: the built-in sample store, for demos (no real customers or payments).
 * Used by the refund and invoice actions.
 */
export type StoreOrder = {
  source: "SHOPIFY" | "SAMPLE";
  /** The store's own id for the order (Shopify), used to refund it. */
  externalId: string | null;
  orderNumber: string;
  placedAt: string;
  cancelled: boolean;
  financialStatus: string | null;
  currency: string;
  lines: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
  subtotal: number;
  tax: number;
  total: number;
  customerName: string | null;
  customerEmail: string | null;
};

export type OrderLookup =
  | { found: true; order: StoreOrder }
  | { found: false; reason: "no_store" | "not_found" | "needs_verification" };

const money = (value: string | number | null | undefined) => Math.round(Number(value ?? 0) * 100) / 100;

export async function findCustomerOrder(
  workspaceId: string,
  input: { orderNumber: string; email: string | null; phone: string | null },
): Promise<OrderLookup> {
  const shopify = await loadConnector(workspaceId, "SHOPIFY");

  if (shopify) {
    const result = await getShopifyOrderDetail(workspaceId, input);

    if (!result.found) {
      return { found: false, reason: result.needsVerification ? "needs_verification" : "not_found" };
    }

    const { order } = result;
    const name = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") || null;

    return {
      found: true,
      order: {
        source: "SHOPIFY",
        externalId: String(order.id),
        orderNumber: order.name.replace(/^#/, ""),
        placedAt: order.created_at,
        cancelled: Boolean(order.cancelled_at),
        financialStatus: order.financial_status,
        currency: order.currency,
        lines: (order.line_items ?? []).map((line) => ({
          description: line.title,
          quantity: line.quantity,
          unitPrice: money(line.price),
          amount: money(Number(line.price) * line.quantity),
        })),
        subtotal: money(order.subtotal_price),
        tax: money(order.total_tax),
        total: money(order.total_price),
        customerName: name,
        customerEmail: order.email ?? order.customer?.email ?? null,
      },
    };
  }

  if (isSampleStoreEnabled()) {
    const sample = sampleOrder(input.orderNumber);

    if (!sample) {
      return { found: false, reason: "not_found" };
    }

    // The sample store's 17% sales tax, as on its invoices.
    const tax = Math.round(sample.total * 0.17);

    return {
      found: true,
      order: {
        source: "SAMPLE",
        externalId: null,
        orderNumber: sample.orderNumber,
        placedAt: new Date(`${sample.placedOn}T12:00:00+05:00`).toISOString(),
        cancelled: false,
        financialStatus: "paid",
        currency: sample.currency,
        lines: sample.items.map((item) => ({
          description: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.unitPrice * item.quantity,
        })),
        subtotal: sample.total,
        tax,
        total: sample.total + tax,
        customerName: null,
        customerEmail: input.email,
      },
    };
  }

  return { found: false, reason: "no_store" };
}

export { ConnectorError };
