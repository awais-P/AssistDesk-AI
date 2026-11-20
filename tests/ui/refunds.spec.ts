import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { WIDGET_ID, openDashboardPage, waitForHydration } from "./helpers";

/**
 * Module 2 FE-1: refund requests decided by the team, and the public invoice page.
 * The rows the AI would create (request_refund, get_invoice) are written straight to the
 * demo database, so these tests don't depend on a model.
 */

async function withDb<T>(run: (db: pg.Client, workspaceId: string) => Promise<T>) {
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  try {
    const [{ workspaceId }] = (await db.query('select "workspaceId" from "Chatbot" where "widgetId" = $1', [WIDGET_ID])).rows;
    return await run(db, workspaceId);
  } finally {
    await db.end();
  }
}

test.describe("Refunds and invoices (M2 FE-1)", () => {
  test("UI-REF-01 a manager approves a refund request the AI collected - M2 FE-1", async ({ page }) => {
    const orderNumber = String(70000 + Math.floor(Math.random() * 20000));
    const id = `ui-refund-${orderNumber}`;
    // No conversation or email is attached, so approving it messages nobody.
    await withDb((db, workspaceId) =>
      db.query(
        `insert into "RefundRequest" ("id", "workspaceId", "orderNumber", "source", "amount", "currency", "reason", "customerName", "updatedAt")
         values ($1, $2, $3, 'MANUAL', 6500, 'PKR', 'The kettle leaks from the base.', 'Hamza Ali', now())`,
        [id, workspaceId, orderNumber],
      ),
    );

    try {
      await openDashboardPage(page, "/dashboard/refunds", "Refunds");
      await expect(page.getByRole("link", { name: "Refunds" }).first()).toBeVisible();

      const row = page.getByRole("listitem", { name: `Refund for order ${orderNumber}` });
      await expect(row).toBeVisible();
      await expect(row.getByText("Waiting for approval")).toBeVisible();
      await expect(row.getByText("The kettle leaks from the base.")).toBeVisible();
      await expect(row.getByText("PKR 6,500")).toBeVisible();

      await row.getByRole("button", { name: "Approve" }).click();
      await expect(row.getByText(/AssistDesk can't send the money/)).toBeVisible();
      await row.getByLabel(/Note/).fill("Leak confirmed from the photo");
      await row.getByRole("button", { name: "Approve refund" }).click();
      await expect(page.getByText(`Refund for order #${orderNumber} approved. Pay it out to the customer.`)).toBeVisible();

      await page.getByRole("tab", { name: "Decided" }).click();
      const decided = page.getByRole("listitem", { name: `Refund for order ${orderNumber}` });
      await expect(decided.getByText("Approved, pay out manually")).toBeVisible();
      await expect(decided.getByText(/Leak confirmed from the photo/)).toBeVisible();
      await expect(decided.getByRole("button", { name: "Approve" })).toHaveCount(0);
    } finally {
      await withDb((db) => db.query('delete from "RefundRequest" where "id" = $1', [id]));
    }
  });

  test("UI-REF-02 the invoice link opens a printable invoice without signing in, and expires - M2 FE-1", async ({ browser }) => {
    const token = randomBytes(24).toString("base64url");
    const expired = randomBytes(24).toString("base64url");
    const data = {
      invoiceNumber: "INV-1042",
      orderNumber: "1042",
      issuedOn: new Date().toISOString(),
      orderedOn: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      currency: "PKR",
      lines: [{ description: "2-slice toaster", quantity: 2, unitPrice: 5800, amount: 11600 }],
      subtotal: 11600,
      tax: 1972,
      total: 13572,
      customerName: null,
      customerEmail: "sara@example.com",
      paymentStatus: "paid",
      sample: true,
    };
    await withDb(async (db, workspaceId) => {
      for (const [value, offset] of [
        [token, 86_400_000],
        [expired, -1000],
      ] as const) {
        await db.query(
          `insert into "OrderInvoice" ("id", "workspaceId", "token", "orderNumber", "source", "data", "expiresAt")
           values ($1, $2, $3, '1042', 'SAMPLE', $4, $5)`,
          // UTC text, as Prisma stores it: a JS Date would be sent in local time and the
          // time-zone-less column would drop the offset.
          [`ui-invoice-${value.slice(0, 12)}`, workspaceId, value, JSON.stringify(data), new Date(Date.now() + offset).toISOString()],
        );
      }
    });

    // A customer has no dashboard session.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      await page.goto(`/invoice/${token}`);
      await waitForHydration(page);
      const invoice = page.getByRole("article", { name: "Invoice" });
      await expect(invoice.getByRole("heading", { name: "Invoice" })).toBeVisible();
      await expect(invoice.getByText("INV-1042")).toBeVisible();
      await expect(invoice.getByText(/Sample data/)).toBeVisible();
      await expect(invoice.getByRole("cell", { name: "2-slice toaster" })).toBeVisible();
      await expect(invoice.getByText("PKR 13,572.00")).toBeVisible();
      await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

      // The button is left out of the printed page / PDF.
      await page.emulateMedia({ media: "print" });
      await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeHidden();
      await page.emulateMedia({ media: "screen" });

      await page.goto(`/invoice/${expired}`);
      await expect(page.getByRole("heading", { name: "This invoice link has expired" })).toBeVisible();
      await expect(page.getByText("INV-1042")).toHaveCount(0);
    } finally {
      await context.close();
      await withDb((db) => db.query('delete from "OrderInvoice" where "token" = any($1)', [[token, expired]]));
    }
  });
});
