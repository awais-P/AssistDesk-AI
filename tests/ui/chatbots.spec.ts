import { expect, test } from "@playwright/test";
import { acceptNextConfirm, openDashboardPage, unique } from "./helpers";

test.describe("Chatbots (FR-12, FR-13, FR-14)", () => {
  test("UI-BOT-01 chatbot cards with edit, delete and copy-embed actions - FR-12.1, FR-12.3, FR-12.6", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openDashboardPage(page, "/dashboard/chatbots", "Chatbots");
    await expect(page.getByText("Website Support Bot").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit chatbot" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete chatbot" }).first()).toBeVisible();

    await page.getByRole("button", { name: "Copy embed snippet" }).first().click();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain("assistdesk-widget.js");
  });

  test("UI-BOT-02 create a chatbot, then delete it - FR-12.2, FR-4.2–4.4, FR-12.5", async ({ page }) => {
    const name = unique("UI Bot");
    await openDashboardPage(page, "/dashboard/chatbots", "Chatbots");
    await page.getByRole("button", { name: "+ New Chatbot" }).click();
    await page.locator("#new-chatbot-name").fill(name);
    await page.locator("#new-chatbot-agent").selectOption({ label: "Support Assistant" });
    await page.locator("#new-chatbot-domain").fill("ui-test-shop.example.com");
    await page.getByRole("button", { name: "Add Domain" }).click();
    await page.getByRole("button", { name: "Use color #14b8a6" }).click();
    await page.getByRole("button", { name: "Create Chatbot" }).click();

    await expect(page).toHaveURL(/\/dashboard\/chatbots\/[a-z0-9]+/);
    await expect(page.locator("#chatbot-name")).toHaveValue(name);
    await expect(page.getByRole("textbox", { name: "Allowed domain ui-test-shop.example.com" })).toBeVisible();

    acceptNextConfirm(page);
    await page.getByRole("button", { name: "Delete Chatbot" }).click();
    await expect(page).toHaveURL(/\/dashboard\/chatbots$/);
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("UI-BOT-03 configuration sections are present - FR-13.1–13.7, FR-14.1–14.8", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/chatbots", "Chatbots");
    await page.getByRole("link", { name: "Edit chatbot" }).first().click();
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible();
    for (const section of ["Basic Information", "AI Responses", "Appearance", "Messages & Fields", "Notifications"]) {
      await expect(page.getByRole("button", { name: section, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("switch", { name: "AI Responses Enabled" })).toBeVisible();
    for (const mode of [/^Always/, /^Operator Offline/, /^Fallback/]) {
      await expect(page.getByRole("radio", { name: mode })).toBeVisible();
    }
    await expect(page.locator("#chatbot-max-ai-messages")).toBeVisible();
  });

  test("UI-BOT-04 saving a change persists after reload - FR-13.9, FR-14.7", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/chatbots", "Chatbots");
    await page.getByRole("link", { name: "Edit chatbot" }).first().click();
    const prompt = page.locator("#chatbot-additional-prompt");
    const original = await prompt.inputValue();
    const marker = `Keep answers short. (${Date.now()})`;

    await prompt.fill(marker);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
    await page.reload();
    await expect(page.locator("#chatbot-additional-prompt")).toHaveValue(marker);

    await page.locator("#chatbot-additional-prompt").fill(original);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
  });

  test("UI-BOT-05 the chatbot name is mandatory - FR-13.3", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/chatbots", "Chatbots");
    await page.getByRole("link", { name: "Edit chatbot" }).first().click();
    await page.locator("#chatbot-name").fill("");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText(/name is required|enter a name|required/i).first()).toBeVisible();
    await page.reload();
    await expect(page.locator("#chatbot-name")).not.toHaveValue("");
  });
});
