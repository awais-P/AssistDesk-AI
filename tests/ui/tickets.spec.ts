import { expect, test } from "@playwright/test";
import { openDashboardPage, unique, waitForHydration } from "./helpers";

test.describe("Tickets (FR-5)", () => {
  test("UI-TKT-01 tickets page lists tickets from the sidebar - FR-5.1, FR-5.6", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForHydration(page);
    await page.getByRole("link", { name: "Tickets", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/tickets$/);
    await expect(page.getByRole("heading", { level: 1, name: "Tickets" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /^Select ticket #/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Actions for ticket #/ }).first()).toBeVisible();
  });

  test("UI-TKT-02 an agent creates a ticket and finds it by search - FR-5.5, FR-5.2", async ({ page }) => {
    const subject = unique("UI test ticket");
    await openDashboardPage(page, "/dashboard/tickets", "Tickets");
    await page.getByRole("button", { name: "Create Ticket" }).first().click();
    await page.locator("#create-ticket-subject").fill(subject);
    await page.locator("#create-ticket-name").fill("Playwright Customer");
    await page.locator("#create-ticket-email").fill("playwright.customer@example.com");
    await page.locator("#create-ticket-details").fill("Created by the automated UI test suite.");
    await page.locator("#create-ticket-priority").selectOption({ index: 1 });
    await page.getByRole("dialog").getByRole("button", { name: "Create Ticket" }).click();
    // The AI reply is written in the background (UI-45), so the dialog closes straight away.
    await expect(page.getByRole("dialog", { name: "Create a support ticket" })).toBeHidden();

    await page.getByLabel("Search tickets").fill(subject);
    await page.getByLabel("Search tickets").press("Enter");
    await expect(page.getByRole("heading", { name: subject })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /^Select ticket #/ })).toHaveCount(1);
  });

  test("UI-TKT-03 searching for an unknown term shows no tickets - FR-5.2", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/tickets", "Tickets");
    await page.getByLabel("Search tickets").fill("zz-no-such-ticket-zz");
    await expect(page.getByRole("checkbox", { name: /^Select ticket #/ })).toHaveCount(0);
  });

  test("UI-TKT-04 filter chips narrow the list by priority - FR-5.3", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/tickets", "Tickets");
    const before = await page.getByRole("checkbox", { name: /^Select ticket #/ }).count();
    await page.getByRole("button", { name: /^Priority/ }).click();
    await page.getByRole("button", { name: "Urgent", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Priority/ })).not.toHaveText(/All/);
    const after = await page.getByRole("checkbox", { name: /^Select ticket #/ }).count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  test("UI-TKT-05 the view switches between grid and list - FR-5.4", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/tickets", "Tickets");
    const grid = page.getByRole("button", { name: /^grid$/i });
    const list = page.getByRole("button", { name: /^list$/i });
    await grid.click();
    await expect(grid).toHaveAttribute("aria-pressed", "true");
    await expect(list).toHaveAttribute("aria-pressed", "false");
    await list.click();
    await expect(list).toHaveAttribute("aria-pressed", "true");
  });

  test("UI-TKT-06 selecting tickets shows the bulk-action bar - FR-5.7", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/tickets", "Tickets");
    await page.getByRole("checkbox", { name: /^Select ticket #/ }).nth(0).check();
    await page.getByRole("checkbox", { name: /^Select ticket #/ }).nth(1).check();
    const bulk = page.getByRole("region", { name: "Bulk actions" });
    await expect(bulk).toBeVisible();
    await expect(bulk).toContainText("2 selected");

    await page.getByLabel("Select all on this page").check();
    const visible = await page.getByRole("checkbox", { name: /^Select ticket #/ }).count();
    await expect(bulk).toContainText(`${visible} selected`);
  });

  test("UI-TKT-07 each ticket has an actions menu - FR-5.8", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/tickets", "Tickets");
    await page.getByRole("button", { name: /^Actions for ticket #/ }).first().click();
    for (const action of ["Copy ticket ID", "View details", "Assign to me", "Close this ticket", "Delete Ticket"]) {
      await expect(page.getByRole("button", { name: action })).toBeVisible();
    }
  });

  test("UI-TKT-08 rows per page and page navigation - FR-5.9", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/tickets", "Tickets");
    // The page size is part of the URL, so the list re-renders after the change.
    await page.getByLabel("Rows per page").selectOption("20");
    await expect(page.getByLabel("Rows per page")).toHaveValue("20");
    await page.getByLabel("Rows per page").selectOption("10");
    await expect(page.getByLabel("Rows per page")).toHaveValue("10");
    await expect.poll(() => page.getByRole("checkbox", { name: /^Select ticket #/ }).count()).toBeLessThanOrEqual(10);
    await expect(page.getByRole("button", { name: "Next page" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous page" })).toBeVisible();
  });
});
