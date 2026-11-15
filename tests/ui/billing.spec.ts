import { expect, test } from "@playwright/test";
import { openDashboardPage } from "./helpers";

/**
 * The purchase flow (checkout, upgrade, cancel, renewal, invoices) is covered by IT-26 and
 * IT-27: buying a plan here would put limits on the shared demo workspace.
 */
test.describe("Subscription & payment (M3)", () => {
  test("UI-BIL-01 the billing page shows the plan, usage against limits and the four plans - M3 FE-1, FE-5", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/billing", "Billing");
    await expect(page.getByRole("heading", { name: "Current plan" })).toBeVisible();
    await expect(page.getByRole("meter", { name: "AI replies this month" })).toBeVisible();
    await expect(page.getByRole("meter", { name: "Team members" })).toBeVisible();
    for (const plan of ["Free", "Starter", "Growth", "Business"]) {
      await expect(page.getByRole("article", { name: `${plan} plan` })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  });

  test("UI-BIL-02 yearly billing shows the yearly prices and the saving - M3 FE-1", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/billing", "Billing");
    const growth = page.getByRole("article", { name: "Growth plan" });
    await expect(growth.getByText("$49")).toBeVisible();
    await page.getByRole("radio", { name: /Yearly/ }).click();
    await expect(growth.getByText("$490")).toBeVisible();
    await expect(growth.getByText("Save $98 a year")).toBeVisible();
  });

  test("UI-BIL-03 a forged Stripe webhook is refused - M3 FE-2", async ({ page }) => {
    const response = await page.request.post("/api/billing/webhook", { data: { id: "evt_forged", type: "checkout.session.completed", data: { object: {} } } });
    expect(response.status()).toBe(400);
  });
});
