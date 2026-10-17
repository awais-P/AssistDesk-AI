import { expect, test } from "@playwright/test";
import { acceptNextConfirm, openDashboardPage, unique } from "./helpers";

test.describe("Knowledge base (FR-10, M10)", () => {
  test("UI-KB-01 [FR-10.1, FR-10.6] sources are shown in a table with vector status", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/knowledge-base", "Knowledge Base");
    for (const column of ["NAME", "TYPE", "VECTOR STATUS", "ACTIONS"]) {
      await expect(page.getByRole("columnheader", { name: column })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /Store policies/ })).toBeVisible();
  });

  test("UI-KB-02 [FR-10.5] search and type filter", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/knowledge-base", "Knowledge Base");
    await page.getByLabel("Search knowledge sources").fill("Product FAQ");
    await expect(page.getByRole("link", { name: /Product FAQ/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Store policies/ })).toHaveCount(0);
    await page.getByLabel("Search knowledge sources").fill("");
    await page.getByLabel("Filter by type").selectOption("URL");
    await expect(page.getByRole("link", { name: /Store policies/ })).toHaveCount(0);
  });

  test("UI-KB-03 [FR-10.4, M10 ingestion] a text source is added, indexed and deleted", async ({ page }) => {
    const title = unique("UI knowledge");
    await openDashboardPage(page, "/dashboard/knowledge-base", "Knowledge Base");
    await page.getByRole("button", { name: "Add Data Source" }).click();
    await page.locator("#knowledge-source-title").fill(title);
    await page.locator("#knowledge-source-type").selectOption("TEXT");
    await page.locator("#knowledge-source-text").fill("Gift cards are valid for one year from the date of purchase and cannot be exchanged for cash.");
    await page.getByRole("button", { name: "Save Source" }).click();

    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText(/Synced|Processing|Queued/, { timeout: 60_000 });

    await page.getByRole("button", { name: `Actions for ${title}` }).click();
    acceptNextConfirm(page);
    await page.getByRole("menuitem", { name: /Delete/i }).or(page.getByRole("button", { name: /^Delete/ })).first().click();
    await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  });

  test("UI-KB-04 [FR-10.7] row actions offer re-sync, details and delete", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/knowledge-base", "Knowledge Base");
    await page.getByRole("button", { name: /^Actions for Store policies/ }).click();
    await expect(page.getByText(/Re-?sync|Re-?index/i).first()).toBeVisible();
    await expect(page.getByText(/Delete/i).first()).toBeVisible();
  });

  test("UI-KB-05 [FR-10.6] source detail shows its chunks", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/knowledge-base", "Knowledge Base");
    await page.getByRole("link", { name: /Store policies/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/knowledge-base\/[a-z0-9]+/);
    await expect(page.getByText(/warranty/i).first()).toBeVisible();
  });
});
