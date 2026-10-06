import { NextResponse } from "next/server";
import { isSampleStoreAuthorized, sampleInvoice } from "@/src/lib/sample-store";

/** Sample store: generate an invoice for an order (demo for the "invoice" HTTP tool). */
export async function POST(request: Request) {
  if (!isSampleStoreAuthorized(request)) {
    return NextResponse.json({ error: "Missing or wrong API key." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { order_number?: unknown };
  const invoice = typeof body.order_number === "string" || typeof body.order_number === "number" ? sampleInvoice(String(body.order_number)) : null;

  return invoice ? NextResponse.json(invoice, { status: 201 }) : NextResponse.json({ error: "Order not found." }, { status: 404 });
}
