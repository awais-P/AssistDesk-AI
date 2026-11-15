import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

test.describe("Chats (FR-6) and live takeover (M5)", () => {
  test("UI-CHT-01 conversations are listed and a thread opens - FR-6.1, FR-6.4", async ({ page }) => {
    await page.goto("/dashboard/chats");
    await waitForHydration(page);
    await page.getByRole("button", { name: "All", exact: true }).click();
    // Only the latest conversations are listed, so find the seeded one by name.
    await page.getByLabel("Search conversations").fill("Ali Raza");
    const conversation = page.getByRole("button", { name: /Ali Raza/ }).first();
    await expect(conversation).toBeVisible();
    await conversation.click();
    await expect(page.getByText(/order 1042/i).first()).toBeVisible();
  });

  test("UI-CHT-02 search filters conversations by customer name - FR-6.3", async ({ page }) => {
    await page.goto("/dashboard/chats");
    await waitForHydration(page);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByLabel("Search conversations").fill("Hina");
    await expect(page.getByRole("button", { name: /Hina Shah/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Ali Raza/ })).toHaveCount(0);
  });

  test("UI-CHT-03 status tabs and channel filter - M5", async ({ page }) => {
    await page.goto("/dashboard/chats");
    await waitForHydration(page);
    for (const tab of ["Open", "Human", "Closed", "All"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
    }
    await page.getByLabel("Filter by channel").selectOption({ label: "Website" });
    await expect(page.getByRole("button", { name: /Ali Raza|Hina Shah|Sara Ahmed/ }).first()).toBeVisible();
  });
});
