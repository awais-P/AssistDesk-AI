import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { acceptNextConfirm, openDashboardPage, unique } from "./helpers";

test.describe("Knowledge base (FR-10, M10)", () => {
  test("UI-KB-01 sources are shown in a table with vector status - FR-10.1, FR-10.6", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/knowledge-base", "Knowledge Base");
    for (const column of ["NAME", "TYPE", "VECTOR STATUS", "ACTIONS"]) {
      await expect(page.getByRole("columnheader", { name: column })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /Store policies/ })).toBeVisible();
  });

  test("UI-KB-02 search and type filter - FR-10.5", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/knowledge-base", "Knowledge Base");
    await page.getByLabel("Search knowledge sources").fill("Product FAQ");
    await expect(page.getByRole("link", { name: /Product FAQ/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Store policies/ })).toHaveCount(0);
    await page.getByLabel("Search knowledge sources").fill("");
    await page.getByLabel("Filter by type").selectOption("URL");
    await expect(page.getByRole("link", { name: /Store policies/ })).toHaveCount(0);
  });

  test("UI-KB-03 a text source is added, indexed and deleted - FR-10.4, M10 ingestion", async ({ page }) => {
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

  test("UI-KB-04 row actions offer re-sync, details and delete - FR-10.7", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/knowledge-base", "Knowledge Base");
    await page.getByRole("button", { name: /^Actions for Store policies/ }).click();
    await expect(page.getByText(/Re-?sync|Re-?index/i).first()).toBeVisible();
    await expect(page.getByText(/Delete/i).first()).toBeVisible();
  });

  test("UI-KB-05 source detail shows its chunks - FR-10.6", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/knowledge-base", "Knowledge Base");
    await page.getByRole("link", { name: /Store policies/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/knowledge-base\/[a-z0-9]+/);
    await expect(page.getByText(/warranty/i).first()).toBeVisible();
  });

  test("UI-KB-06 a Word .doc is uploaded with a progress bar and indexed; Knowledge Base sits under AI - FR-10.1, FR-10.2", async ({ page }) => {
    test.setTimeout(150_000);
    const title = unique("Word 97 returns");
    await openDashboardPage(page, "/dashboard/knowledge-base", "Knowledge Base");
    // FR-10.1: the link is in the AI group of the sidebar.
    await expect(page.getByText("AI", { exact: true }).locator("xpath=following::a[1]")).toHaveText(/AI Agents/);
    await expect(page.getByRole("link", { name: "Knowledge Base" }).first()).toBeVisible();

    await page.getByRole("button", { name: "Add Data Source" }).click();
    await page.locator("#knowledge-source-title").fill(title);
    await page.locator("#knowledge-source-type").selectOption("FILE");
    await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), "tests", "fixtures", "returns-policy.doc"));
    const sawProgress = page.getByRole("progressbar", { name: "Upload progress" }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
    await page.getByRole("button", { name: "Save Source" }).click();
    expect(await sawProgress).toBe(true);

    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toContainText("Synced", { timeout: 90_000 });
    await page.getByRole("link", { name: title }).click();
    await expect(page.getByText(/returned within 30 days of delivery/).first()).toBeVisible();
    await deleteSources(page, [title]);
  });

  test("UI-KB-07 several sources are selected and deleted at once - FR-10.6", async ({ page }) => {
    test.setTimeout(150_000);
    const titles = [unique("Bulk A"), unique("Bulk B")];
    await openDashboardPage(page, "/dashboard/knowledge-base", "Knowledge Base");
    for (const title of titles) {
      await page.getByRole("button", { name: "Add Data Source" }).click();
      await page.locator("#knowledge-source-title").fill(title);
      await page.locator("#knowledge-source-type").selectOption("TEXT");
      await page.locator("#knowledge-source-text").fill(`${title}: orders over PKR 10,000 ship free.`);
      await page.getByRole("button", { name: "Save Source" }).click();
      await expect(page.getByRole("link", { name: title })).toBeVisible();
    }

    await deleteSources(page, titles);
    await expect(page.getByRole("status").filter({ hasText: "2 sources deleted." })).toBeVisible();
  });

  test("UI-KB-08 the table's search and sort stay when you open a source and come back (Zustand, TanStack Query) - FR-10.5, SRS CON-2", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/knowledge-base", "Knowledge Base");
    await page.getByLabel("Search knowledge sources").fill("Store");
    await page.getByLabel("Sort sources").selectOption("NAME");
    await expect(page.getByRole("link", { name: /Product FAQ/ })).toHaveCount(0);

    await page.getByRole("link", { name: /Store policies/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/knowledge-base\/[a-z0-9]+/);
    // Back through the sidebar: the list is mounted again, not restored from the browser cache.
    await page.getByRole("link", { name: "Knowledge Base" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Knowledge Base" })).toBeVisible();
    await expect(page.getByLabel("Search knowledge sources")).toHaveValue("Store");
    await expect(page.getByLabel("Sort sources")).toHaveValue("NAME");
    await expect(page.getByRole("link", { name: /Store policies/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Product FAQ/ })).toHaveCount(0);
  });
});

/** Ticks the sources' checkboxes and deletes them with the bulk bar. */
async function deleteSources(page: Page, titles: string[]) {
  await page.goto("/dashboard/knowledge-base");
  for (const title of titles) {
    await page.getByRole("checkbox", { name: `Select ${title}` }).check();
  }
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(bar).toContainText(`${titles.length} selected`);
  acceptNextConfirm(page);
  await bar.getByRole("button", { name: "Delete" }).click();
  for (const title of titles) {
    await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  }
}
