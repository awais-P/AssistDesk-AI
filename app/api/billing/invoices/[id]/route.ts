import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { PLAN_BY_KEY, type PlanKey, formatPrice } from "@/src/lib/billing-plans";
import { can } from "@/src/lib/permissions";
import { prisma } from "@/src/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "—");

/** Module 3 FE-5: a printable invoice (Stripe invoices also link Stripe's own PDF). */
export async function GET(_request: Request, context: RouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!can(session.user, "billing.manage")) {
    return NextResponse.json({ error: "Only people who manage the subscription can see invoices." }, { status: 403 });
  }

  const { id } = await context.params;
  const invoice = await prisma.invoice.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    include: { workspace: { select: { name: true, supportEmail: true } } },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const planName = PLAN_BY_KEY.get(invoice.plan as PlanKey)?.name ?? invoice.plan;
  const description = `AssistDesk ${planName} plan, billed ${invoice.interval === "YEAR" ? "yearly" : "monthly"} (${day(invoice.periodStart)} to ${day(invoice.periodEnd)})`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${escape(invoice.number)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111;max-width:760px;margin:40px auto;padding:0 20px}
h1{font-size:28px;margin:0}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}
td.amount,th.amount{text-align:right}.muted{color:#666}.badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:12px;background:${invoice.status === "PAID" ? "#dcfce7" : "#fee2e2"}}
.test{margin-top:16px;padding:8px 12px;background:#fef9c3;border-radius:8px;font-size:13px}@media print{.noprint{display:none}}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start">
<div><h1>Invoice</h1><p class="muted">${escape(invoice.number)} · issued ${day(invoice.createdAt)}</p></div>
<div style="text-align:right"><strong>AssistDesk</strong><br><span class="muted">AI customer support platform</span></div></div>
<p><strong>Billed to</strong><br>${escape(invoice.workspace.name)}${invoice.workspace.supportEmail ? `<br>${escape(invoice.workspace.supportEmail)}` : ""}</p>
<p>Status: <span class="badge">${escape(invoice.status)}</span>${invoice.paidAt ? ` · paid ${day(invoice.paidAt)}` : ""}</p>
<table><thead><tr><th>Description</th><th class="amount">Amount</th></tr></thead>
<tbody><tr><td>${escape(description)}</td><td class="amount">${formatPrice(invoice.amountDue, invoice.currency)}</td></tr></tbody>
<tfoot><tr><th>Total paid</th><th class="amount">${formatPrice(invoice.amountPaid, invoice.currency)}</th></tr></tfoot></table>
${invoice.provider === "TEST" ? '<p class="test">Test mode: no real payment was taken.</p>' : ""}
${invoice.pdfUrl ? `<p class="noprint"><a href="${escape(invoice.pdfUrl)}">Download Stripe's PDF</a></p>` : ""}
<p class="noprint"><button onclick="window.print()">Print or save as PDF</button></p>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" } });
}
