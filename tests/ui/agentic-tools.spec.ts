import { expect, test } from "@playwright/test";
import { openDashboardPage } from "./helpers";

test.describe("Agentic tools and action logs (M2)", () => {
  test("UI-M2-01 built-in actions and custom tools are listed with on/off switches - M2 FE-1, FE-2b", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/tools", "Tools");
    for (const tool of ["Search knowledge base", "Create support ticket", "Book appointment", "Hand over to a human", "Track order"]) {
      await expect(page.getByRole("switch", { name: new RegExp(`Switch (off|on) ${tool}`) })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "New tool" })).toBeVisible();
  });

  test("UI-M2-02 a tool can be test-run from the Tools page - M2 FE-3", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/tools", "Tools");
    await page.getByRole("button", { name: "Test" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^Run/ }).click();
    await expect(dialog.getByText(/success|result|error/i).first()).toBeVisible({ timeout: 60_000 });
  });

  test("UI-M2-03 action logs list runs and show the chain of thought - M2 FE-5, UI-4", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/logs?tab=actions", "Logs");
    await expect(page.getByRole("tab", { name: "Conversation turns" })).toBeVisible();
    // Newer runs push the seeded one off the first page, so search for it.
    await page.getByRole("searchbox", { name: "Search the action logs" }).fill("where is my order 1042");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("button", { name: /Hi, where is my order 1042\?/ }).first().click();
    const trace = page.getByRole("dialog", { name: "Chain of thought" });
    await expect(trace).toBeVisible();
    await expect(trace.getByText("Intent rule matched")).toBeVisible();
    await expect(trace.getByText("Track order", { exact: true })).toBeVisible();
    await expect(trace.getByText(/^Why:/).first()).toBeVisible();
  });

  test("UI-M2-04 action logs filter by action and status - M2 UI-4", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/logs?tab=actions", "Logs");
    await page.getByRole("combobox", { name: "Action" }).selectOption({ label: "Book appointment" });
    await expect(page.getByRole("button", { name: /book an appointment|Yes please/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /where is my order/ })).toHaveCount(0);
  });

  test("UI-M2-05 appointments booked by the AI are listed and the team can book one - M2 FE-1", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/appointments", "Appointments");
    await expect(page.getByRole("link", { name: "Sara Ahmed" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Open the chat it was booked in/ }).first()).toBeVisible();
    await page.getByRole("button", { name: "Book appointment" }).click();
    await expect(page.locator("#book-date")).toBeVisible();
    await expect(page.locator("#book-name")).toBeVisible();
    await page.getByText("Close", { exact: true }).click();
  });
});
