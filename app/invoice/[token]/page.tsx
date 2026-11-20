import type { Metadata } from "next";
import { PrintButton } from "@/src/components/invoice/print-button";
import { loadOrderInvoice } from "@/src/lib/order-invoices";

type InvoicePageProps = { params: Promise<{ token: string }> };

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
  // The link is the secret: never pass it on to other sites.
  referrer: "no-referrer",
  alternates: { canonical: null },
};

const formatDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

/**
 * Module 2 FE-1: a customer's invoice, opened from the link the AI shared (get_invoice).
 * Public by design: the link itself is the secret (24 random bytes) and stops working
 * after 30 days. The browser's print dialog saves it as a PDF.
 */
export default async function InvoicePage({ params }: InvoicePageProps) {
  const { token } = await params;
  const invoice = await loadOrderInvoice(token);

  if (!invoice) {
    return (
      <main className="flex min-h-screen flex-1 items-center justify-center bg-slate-100 px-4 text-slate-900">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">This invoice link has expired</h1>
          <p className="mt-2 text-sm text-slate-600">Invoice links work for 30 days. Ask the assistant in chat for a new one.</p>
        </div>
      </main>
    );
  }

  const { data, store } = invoice;
  const money = (value: number) => `${data.currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <main className="flex min-h-screen flex-1 justify-center bg-slate-100 px-4 py-8 text-slate-900 print:bg-white print:p-0">
      <div className="w-full max-w-3xl">
        <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
          <p className="text-sm text-slate-600">This link works until {formatDate(invoice.expiresAt.toISOString())}.</p>
          <PrintButton />
        </div>

        <article className="rounded-2xl bg-white p-8 shadow-sm print:rounded-none print:p-0 print:shadow-none" aria-label="Invoice">
          {data.sample ? (
            <p className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Sample data: this invoice comes from the demo store and is not a real purchase.
            </p>
          ) : null}

          <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-lg font-semibold">{store.name}</p>
              {store.supportEmail ? <p className="text-sm text-slate-600">{store.supportEmail}</p> : null}
            </div>
            <div className="sm:text-right">
              <h1 className="text-2xl font-bold tracking-tight">Invoice</h1>
              <p className="mt-1 text-sm text-slate-600">{data.invoiceNumber}</p>
            </div>
          </header>

          <dl className="mt-8 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billed to</dt>
              <dd className="mt-1">{data.customerName || data.customerEmail || "Customer"}</dd>
              {data.customerName && data.customerEmail ? <dd className="text-slate-600">{data.customerEmail}</dd> : null}
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order</dt>
              <dd className="mt-1">#{data.orderNumber}</dd>
              <dd className="text-slate-600">Placed {formatDate(data.orderedOn)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Issued</dt>
              <dd className="mt-1">{formatDate(data.issuedOn)}</dd>
              {data.paymentStatus ? <dd className="capitalize text-slate-600">Payment: {data.paymentStatus.replace(/_/g, " ")}</dd> : null}
            </div>
          </dl>

          <table className="mt-8 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th scope="col" className="py-2 font-semibold">
                  Item
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  Qty
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  Unit price
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line, index) => (
                <tr key={`${line.description}-${index}`} className="border-b border-slate-100">
                  <td className="py-3 pr-3">{line.description}</td>
                  <td className="py-3 text-right">{line.quantity}</td>
                  <td className="py-3 text-right">{money(line.unitPrice)}</td>
                  <td className="py-3 text-right">{money(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto mt-6 w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Subtotal</dt>
              <dd>{money(data.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Tax</dt>
              <dd>{money(data.tax)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd>{money(data.total)}</dd>
            </div>
          </dl>

          <p className="mt-10 text-xs text-slate-500">
            Questions about this invoice? {store.supportEmail ? `Email ${store.supportEmail} or reply` : "Reply"} in the chat where you asked for it.
          </p>
        </article>
      </div>
    </main>
  );
}
