import { expect, test } from "@playwright/test";
import { acceptNextConfirm, openDashboardPage, unique } from "./helpers";

test.describe("AI agents (FR-7, FR-8)", () => {
  test("UI-AGT-01 [FR-7.1, FR-7.5] agents page shows the agent cards", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/ai-agents", "Agents");
    await expect(page.getByText("Support Assistant").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Agent" }).first()).toBeVisible();
  });

  test("UI-AGT-02 [FR-7.2] search filters agents by name", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/ai-agents", "Agents");
    await page.getByPlaceholder("Search...").fill("zz-no-agent-zz");
    await expect(page.getByRole("link", { name: "Open Agent" })).toHaveCount(0);
    await page.getByPlaceholder("Search...").fill("");
    await expect(page.getByRole("link", { name: "Open Agent" }).first()).toBeVisible();
  });

  test("UI-AGT-03 [FR-7.3] grid and list views", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/ai-agents", "Agents");
    await page.getByRole("button", { name: /^list$/i }).click();
    await expect(page.getByText("Support Assistant").first()).toBeVisible();
    await page.getByRole("button", { name: /^grid$/i }).click();
    await expect(page.getByText("Support Assistant").first()).toBeVisible();
  });

  test("UI-AGT-04 [FR-7.4, FR-8.2–8.8, FR-7.6] create, configure and delete an agent", async ({ page }) => {
    const name = unique("UI Agent");
    await openDashboardPage(page, "/dashboard/ai-agents", "Agents");
    await page.getByRole("button", { name: "+ Create Agent" }).click();
    await page.locator("#create-agent-name").fill(name);
    await page.locator("#create-agent-provider").selectOption({ label: "Default (Managed)" });
    await page.locator("#create-agent-tone").selectOption("Professional");
    await page.locator("#create-agent-temperature").fill("0.3");
    await page.locator("#create-agent-confidence").fill("0.6");
    await page.locator("#create-agent-system-prompt").fill("You are a concise test assistant.");
    await page.getByRole("button", { name: "Create Agent", exact: true }).click();

    // FR-8.1 (deviation): editing opens the agent's own page with tabs.
    // The agent page is compiled on first use in dev mode, so allow extra time.
    await expect(page).toHaveURL(/\/dashboard\/ai-agents\/[a-z0-9]+/, { timeout: 90_000 });
    await expect(page.getByText(name).first()).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByText(/temperature/i).first()).toBeVisible();

    await openDashboardPage(page, "/dashboard/ai-agents", "Agents");
    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    acceptNextConfirm(page);
    await page.getByRole("menuitem", { name: /Delete/i }).or(page.getByRole("button", { name: /^Delete/ })).first().click();
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("UI-AGT-05 [FR-8.2] an agent cannot be created without a name", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/ai-agents", "Agents");
    const cards = await page.getByRole("link", { name: "Open Agent" }).count();
    await page.getByRole("button", { name: "+ Create Agent" }).click();
    await page.locator("#create-agent-name").fill("");
    await page.getByRole("button", { name: "Create Agent", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/ai-agents$/);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("link", { name: "Open Agent" })).toHaveCount(cards);
  });

  test("UI-AGT-06 [M2] agent tabs: Actions and Playground", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/ai-agents", "Agents");
    await page.getByRole("link", { name: "Open Agent" }).first().click();
    await page.getByRole("button", { name: "Actions", exact: true }).click();
    await expect(page.getByText(/Allowed actions/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Playground", exact: true }).click();
    await expect(page.getByRole("textbox").last()).toBeVisible();
  });
});
