/**
 * A tiny sample e-commerce API used to demonstrate custom HTTP tools (Module 2
 * FE-1/FE-2b: order tracking, invoice generation) without a real store. The data is
 * generated from the order number and is clearly marked as sample data. Businesses
 * point their HTTP tools at their own systems instead.
 */

export const SAMPLE_STORE_KEY = "demo-store-key";

const CATALOG = [
  { sku: "KT-100", name: "Electric kettle 1.7 L", price: 6500 },
  { sku: "KT-210", name: "Steel kettle 2 L", price: 4200 },
  { sku: "TS-300", name: "2-slice toaster", price: 5800 },
  { sku: "BL-400", name: "Blender 600 W", price: 9900 },
];
const STATUSES = ["PROCESSING", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"] as const;
const CARRIERS = ["TCS", "Leopards Courier", "M&P"];

/** On in development; in production only when ASSISTDESK_SAMPLE_STORE="true" (demo deployments). */
export function isSampleStoreEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.ASSISTDESK_SAMPLE_STORE === "true";
}

export function isSampleStoreAuthorized(request: Request) {
  return request.headers.get("authorization") === `Bearer ${SAMPLE_STORE_KEY}`;
}

/** The demo shop is in Pakistan: its dates are local calendar dates, not UTC. */
const STORE_TIME_ZONE = "Asia/Karachi";

function storeDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function sampleOrder(orderNumber: string, now = new Date()) {
  const number = Number(orderNumber.replace(/\D/g, ""));

  if (!Number.isInteger(number) || number < 1000 || number > 99999) {
    return null;
  }

  const item = CATALOG[number % CATALOG.length];
  const quantity = (number % 3) + 1;
  const status = STATUSES[number % STATUSES.length];
  const day = 24 * 60 * 60 * 1000;
  const placed = new Date(now.getTime() - ((number % 6) + 2) * day);
  // Dates stay consistent with the status: delivered orders arrived yesterday, orders out
  // for delivery arrive today, everything else is due in the next few days.
  const eta =
    status === "DELIVERED"
      ? new Date(now.getTime() - day)
      : status === "OUT_FOR_DELIVERY"
        ? now
        : new Date(now.getTime() + ((number % 3) + 1) * day);

  return {
    sample: true,
    orderNumber: String(number),
    status,
    placedOn: storeDate(placed),
    estimatedDelivery: status === "DELIVERED" ? null : storeDate(eta),
    deliveredOn: status === "DELIVERED" ? storeDate(eta) : null,
    carrier: status === "PROCESSING" ? null : CARRIERS[number % CARRIERS.length],
    trackingNumber: status === "PROCESSING" ? null : `TRK${String(number * 7919).padStart(9, "0")}`,
    items: [{ sku: item.sku, name: item.name, quantity, unitPrice: item.price }],
    total: item.price * quantity,
    currency: "PKR",
  };
}

export function sampleInvoice(orderNumber: string, now = new Date()) {
  const order = sampleOrder(orderNumber, now);

  if (!order) {
    return null;
  }

  return {
    sample: true,
    invoiceNumber: `INV-${order.orderNumber}`,
    orderNumber: order.orderNumber,
    issuedOn: storeDate(now),
    lines: order.items.map((line) => ({ description: line.name, quantity: line.quantity, amount: line.unitPrice * line.quantity })),
    subtotal: order.total,
    tax: Math.round(order.total * 0.17),
    total: Math.round(order.total * 1.17),
    currency: "PKR",
  };
}
