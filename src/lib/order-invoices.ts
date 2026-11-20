import { randomBytes } from "node:crypto";
import type { Prisma } from "@/app/generated/prisma/client";
import { getAppUrl } from "./llm-runtime";
import { prisma } from "./prisma";
import type { StoreOrder } from "./store-orders";

/**
 * Module 2 FE-1: a printable invoice for a customer's order, shared as a link. The
 * invoice is a snapshot of the order when it was asked for; the link is unguessable and
 * stops working after 30 days. The page (app/invoice/[token]) can be saved as a PDF.
 */
export const INVOICE_LINK_DAYS = 30;

export type InvoiceData = {
  invoiceNumber: string;
  orderNumber: string;
  issuedOn: string;
  orderedOn: string;
  currency: string;
  lines: StoreOrder["lines"];
  subtotal: number;
  tax: number;
  total: number;
  customerName: string | null;
  customerEmail: string | null;
  paymentStatus: string | null;
  sample: boolean;
};

export async function createOrderInvoice(workspaceId: string, order: StoreOrder, now = new Date()) {
  const data: InvoiceData = {
    invoiceNumber: `INV-${order.orderNumber}`,
    orderNumber: order.orderNumber,
    issuedOn: now.toISOString(),
    orderedOn: order.placedAt,
    currency: order.currency,
    lines: order.lines,
    subtotal: order.subtotal,
    tax: order.tax,
    total: order.total,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    paymentStatus: order.financialStatus,
    sample: order.source === "SAMPLE",
  };
  const token = randomBytes(24).toString("base64url");
  await prisma.orderInvoice.create({
    data: {
      workspaceId,
      token,
      orderNumber: order.orderNumber,
      source: order.source,
      data: data as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(now.getTime() + INVOICE_LINK_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  return { token, url: `${getAppUrl()}/invoice/${token}`, data };
}

/** The invoice behind a link, or null when it doesn't exist or has expired. */
export async function loadOrderInvoice(token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return null;
  }

  const invoice = await prisma.orderInvoice.findUnique({
    where: { token },
    select: { expiresAt: true, data: true, workspace: { select: { name: true, supportEmail: true } } },
  });

  if (!invoice || invoice.expiresAt <= now) {
    return null;
  }

  return { store: invoice.workspace, data: invoice.data as unknown as InvoiceData, expiresAt: invoice.expiresAt };
}
