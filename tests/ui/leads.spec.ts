import { expect, test } from "@playwright/test";
import { openDashboardPage } from "./helpers";

test.describe("Lead generation (M8)", () => {
  test("UI-LED-01 leads list with status tabs and filters - M8 FE-5", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/leads", "Leads");
    // The end-to-end API suite adds its own "Usman Tariq" leads, so the name may appear more than once.
    await expect(page.getByRole("link", { name: "Usman Tariq" }).first()).toBeVisible();
    const leadLinks = page.getByRole("main").getByRole("link", { name: /^(Kamran Javed|Mariam Siddiqui|Usman Tariq|Sara Ahmed)$/ });
    const qualifiedTab = page.getByRole("navigation", { name: "Lead status" }).getByRole("button", { name: /^Qualified/ });
    const qualified = Number((await qualifiedTab.innerText()).replace(/\D/g, ""));
    await qualifiedTab.click();
    await expect(leadLinks).toHaveCount(qualified);
    await page.getByRole("button", { name: /^All/ }).click();
    await page.getByLabel("Search leads").fill("Pearl");
    await expect(page.getByRole("link", { name: "Usman Tariq" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Sara Ahmed" })).toHaveCount(0);
  });

  test("UI-LED-02 lead detail shows score, source conversation and history - M8 FE-1, FE-2", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/leads", "Leads");
    await page.getByRole("link", { name: "Usman Tariq" }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/leads\/[a-z0-9]+/);
    await expect(page.getByText(/score/i).first()).toBeVisible();
    await expect(page.getByText(/Pearl/).first()).toBeVisible();
  });

  test("UI-LED-03 leads export as CSV - M8 FE-4", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/leads", "Leads");
    const response = await page.request.get("/api/leads/export");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(await response.text()).toContain("Usman Tariq");
  });

  test("UI-LED-04 lead form and webhook settings - M8 FE-1", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/leads", "Leads");
    await page.getByRole("main").getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/dashboard\/leads\/settings/);
    await expect(page.getByText(/webhook/i).first()).toBeVisible();
  });
});
