import { expect, test } from "@playwright/test";
import { openDashboardPage, unique } from "./helpers";

test.describe("Integrations & system customization (M11)", () => {
  test("UI-M11-01 the security & audit log lists sign-ins and filters refused access - M11 FE-5", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/logs?tab=audit", "Logs");
    await expect(page.getByRole("link", { name: "Security & audit" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("auth.login").first()).toBeVisible();
    await page.getByLabel("Outcome").selectOption("DENIED");
    await expect(page.getByText("auth.login")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByText("auth.login").first()).toBeVisible();
  });

  test("UI-M11-02 an API key is shown once, works on the public API and stops after revoking - M11 FE-2", async ({ page }) => {
    const name = unique("UI key");
    await openDashboardPage(page, "/dashboard/api-keys", "API Keys");
    await page.getByRole("button", { name: "Create API key" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Create key" }).click();
    const secret = (await page.getByLabel("New API key").innerText()).trim();
    expect(secret).toMatch(/^ad_live_/);

    const ok = await page.request.get("/api/v1/tickets?limit=1", { headers: { authorization: `Bearer ${secret}` } });
    expect(ok.status()).toBe(200);

    await page.getByRole("button", { name: "Done" }).click();
    const row = page.getByRole("row").filter({ hasText: name });
    await row.getByRole("button", { name: "Revoke" }).click();
    await row.getByRole("button", { name: "Revoke now" }).click();
    await expect(row.getByText("Revoked")).toBeVisible();
    const refused = await page.request.get("/api/v1/tickets?limit=1", { headers: { authorization: `Bearer ${secret}` } });
    expect(refused.status()).toBe(401);
  });

  test("UI-M11-03 a custom role adds a permission and shows in the matrix - M11 FE-3, FE-4", async ({ page }) => {
    const name = unique("Senior agent").slice(0, 36);
    await openDashboardPage(page, "/dashboard/roles", "Roles");
    await page.getByRole("button", { name: "Create role" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Based on").selectOption("AGENT");
    await page.getByLabel(/Export data/).check();
    await page.getByRole("button", { name: "Create role" }).last().click();
    await expect(page.getByRole("status").filter({ hasText: `Role "${name}" created` })).toBeVisible();
    await expect(page.getByRole("columnheader", { name })).toBeVisible();

    const item = page.getByRole("listitem").filter({ hasText: name });
    await expect(item.getByText(/adds 1/)).toBeVisible();
    await item.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("columnheader", { name })).toHaveCount(0);
  });

  test("UI-M11-04 connectors check the store address before connecting - M11 FE-1", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/connectors", "Connectors");
    await expect(page.getByRole("heading", { name: /HubSpot/ })).toBeVisible();
    await page.getByLabel("Store address").fill("evil.example.com");
    await page.getByLabel("Admin API access token").fill("fake-shopify-token-for-tests");
    await page.getByRole("button", { name: "Connect Shopify" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "myshopify.com" })).toBeVisible();
  });

  test("UI-M11-05 the public API description is served - M11 FE-2", async ({ page }) => {
    const response = await page.request.get("/api/v1/openapi.json");
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).info.title).toBe("AssistDesk public API");
  });
});
