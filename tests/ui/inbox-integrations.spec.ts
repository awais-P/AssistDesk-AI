import { expect, test } from "@playwright/test";
import { openDashboardPage } from "./helpers";

test.describe("Inbox configuration (FR-15)", () => {
  test("UI-INB-01 [FR-15.1–15.4, FR-15.6, FR-15.7] inbox fields and sender options", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/inboxes", "Inboxes");
    await page.getByRole("link", { name: "Edit" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Inbox Configuration" })).toBeVisible();
    await expect(page.getByLabel("Inbox Name")).not.toHaveValue("");
    await expect(page.getByRole("button", { name: "Check" })).toBeVisible();
    await expect(page.getByLabel("Ticket Prefix")).not.toHaveValue("");
    await expect(page.locator("#sender-mode-default")).toBeChecked();
    await expect(page.locator("#sender-mode-custom")).toBeVisible();
  });

  test("UI-INB-02 [FR-15.8] a renamed inbox is saved", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/inboxes", "Inboxes");
    await page.getByRole("link", { name: "Edit" }).first().click();
    const name = page.getByLabel("Inbox Name");
    await name.fill("Support Desk");
    await page.getByRole("button", { name: "Save Changes" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: /updated successfully/i })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Inbox Name")).toHaveValue("Support Desk");
    await page.getByLabel("Inbox Name").fill("Support");
    await page.getByRole("button", { name: "Save Changes" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: /updated successfully/i })).toBeVisible();
  });

  test("UI-INB-03 [FR-15.2] the inbox name cannot be blank", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/inboxes", "Inboxes");
    await page.getByRole("link", { name: "Edit" }).first().click();
    await page.getByLabel("Inbox Name").fill("");
    await page.getByRole("button", { name: "Save Changes" }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: "Give the inbox a name" })).toBeVisible();
  });
});

test.describe("Omnichannel integrations (FR-16)", () => {
  test("UI-INT-01 [FR-16.1–16.5] channels are listed with connect actions", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/integrations", "Integrations");
    for (const action of ["Connect Email", "Connect Slack", "Connect WhatsApp"]) {
      await expect(page.getByRole("button", { name: action })).toBeVisible();
    }
    await expect(page.getByRole("switch", { name: "Enable web chat widgets" })).toBeVisible();
    await expect(page.getByRole("switch", { name: /Enable Primary Email Integration/ })).toBeVisible();
  });

  test("UI-INT-02 [FR-16.7] an integration can be switched off and on", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/integrations", "Integrations");
    const toggle = page.getByRole("switch", { name: /Enable Primary Email Integration/ });
    const initial = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await expect(toggle).not.toHaveAttribute("aria-checked", initial ?? "");
    await page.reload();
    await expect(page.getByRole("switch", { name: /Enable Primary Email Integration/ })).not.toHaveAttribute("aria-checked", initial ?? "");
    await page.getByRole("switch", { name: /Enable Primary Email Integration/ }).click();
    await expect(page.getByRole("switch", { name: /Enable Primary Email Integration/ })).toHaveAttribute("aria-checked", initial ?? "");
  });
});
