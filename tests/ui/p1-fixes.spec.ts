import { expect, test } from "@playwright/test";
import { openDashboardPage, unique } from "./helpers";

test.describe("Priority-1 fixes (16 Nov 2026)", () => {
  test("UI-P1-01 an inbox auto-reply is switched on with a canned response - FR-15.5", async ({ page }) => {
    const title = unique("Auto-reply");
    const created = await page.request.post("/api/canned-responses", { data: { title, body: "Hi {{customer_name}}, we received your request." } });
    expect(created.ok()).toBeTruthy();

    await openDashboardPage(page, "/dashboard/inboxes", "Inboxes");
    await page.getByRole("link", { name: "Edit" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Inbox Configuration" })).toBeVisible();
    const toggle = page.getByRole("switch", { name: "Auto-reply" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await toggle.click();
    await page.getByRole("button", { name: "Save Changes" }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: "Choose the canned response" })).toBeVisible();

    await page.getByLabel("Canned response to send").selectOption({ label: title });
    await page.getByRole("button", { name: "Save Changes" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: /updated successfully/i })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("switch", { name: "Auto-reply" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Canned response to send").locator("option:checked")).toHaveText(title);

    // Leave the shared demo inbox as it was.
    await page.getByRole("switch", { name: "Auto-reply" }).click();
    await page.getByRole("button", { name: "Save Changes" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: /updated successfully/i })).toBeVisible();
  });

  test("UI-P1-02 the automation drawer explains what each setting accepts - BUG-03, UI-44", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/ai-agents", "Agents");
    await page.getByRole("link", { name: "Open Agent" }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/ai-agents\/[a-z0-9]+/, { timeout: 90_000 });
    await page.goto(`${page.url().split("?")[0]}?tab=automations`);
    const blockList = page.locator("article").filter({ hasText: "Block List" });
    await blockList.getByRole("button", { name: "Configure" }).click();
    await expect(page.getByLabel("Blocked senders and keywords")).toBeVisible();
    await expect(page.getByText(/a whole domain such as example\.org/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    const followUp = page.locator("article").filter({ hasText: "AI Follow-up" });
    await followUp.getByRole("button", { name: "Configure" }).click();
    await expect(page.getByText(/one short follow-up email is sent/)).toBeVisible();
  });

  test("UI-P1-03 the dashboard can't be framed, the widget can, and cross-site writes are refused - SEC-14", async ({ page }) => {
    const dashboard = await page.request.get("/dashboard");
    expect(dashboard.headers()["x-frame-options"]).toBe("DENY");
    expect(dashboard.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(dashboard.headers()["x-content-type-options"]).toBe("nosniff");

    const widget = await page.request.get(`/widget/${process.env.E2E_WIDGET_ID ?? "assistdesk-widget-demo"}`, { headers: { referer: "http://localhost:8080/shop" } });
    expect(widget.headers()["x-frame-options"]).toBeUndefined();
    expect(widget.headers()["content-security-policy"] ?? "").not.toContain("frame-ancestors");

    const crossSite = await page.request.post("/api/tags", { headers: { origin: "https://evil.example.com" }, data: { name: "x" } });
    expect(crossSite.status()).toBe(403);
  });
});
