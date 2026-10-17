import { expect, test } from "@playwright/test";
import { acceptNextConfirm, openDashboardPage, unique } from "./helpers";

test.describe("Prompts (FR-9)", () => {
  test("UI-PRM-01 [FR-9.1, FR-9.4] prompt cards are listed", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/prompts", "Prompts");
    await expect(page.getByRole("heading", { name: "Polite resolution reply" })).toBeVisible();
  });

  test("UI-PRM-02 [FR-9.3, FR-9.6, FR-9.2, FR-9.5] create a prompt with variables, search it and delete it", async ({ page }) => {
    const name = unique("UI prompt");
    await openDashboardPage(page, "/dashboard/prompts", "Prompts");
    await page.getByRole("button", { name: "+ New Prompt" }).click();
    await page.locator("#prompt-name").fill(name);
    await page.locator("#prompt-body").fill("Reply politely to ");
    await page.getByRole("button", { name: /^Insert \{\{customer_name\}\}/ }).click();
    await expect(page.locator("#prompt-body")).toHaveValue(/\{\{customer_name\}\}/);
    await page.getByRole("button", { name: "Create Prompt" }).click();

    await page.getByLabel("Search prompts").fill(name);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Polite resolution reply" })).toHaveCount(0);

    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    acceptNextConfirm(page);
    await page.getByRole("menuitem", { name: /Delete/i }).or(page.getByRole("button", { name: /^Delete/ })).first().click();
    await expect(page.getByRole("heading", { name })).toHaveCount(0);
  });

  test("UI-PRM-03 [FR-9.3] name and body are mandatory", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/prompts", "Prompts");
    await page.getByRole("button", { name: "+ New Prompt" }).click();
    await page.getByRole("button", { name: "Create Prompt" }).click();
    await expect(page.getByRole("heading", { name: "New Prompt" })).toBeVisible();
  });
});
