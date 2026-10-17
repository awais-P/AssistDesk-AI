import { expect, test } from "@playwright/test";
import { openDashboardPage } from "./helpers";

test.describe("Monitoring and analytics (FR-11, M4)", () => {
  test("UI-ANL-01 [FR-11.1–11.4] KPI cards are shown", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/analytics", "Analytics");
    for (const kpi of [/response time/i, /automation rate/i, /leads/i, /live sessions/i]) {
      await expect(page.getByText(kpi).first()).toBeVisible();
    }
  });

  test("UI-ANL-02 [FR-11.5] latency chart with an accessible table view", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/analytics", "Analytics");
    await expect(page.getByRole("heading", { name: "System latency" })).toBeVisible();
    await page.getByRole("button", { name: "Show system latency as a table" }).click();
    await expect(page.getByRole("columnheader", { name: "p95" }).first()).toBeVisible();
  });

  test("UI-ANL-03 [FR-11.6, FR-11.7] recent interactions with channel and transcript", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/analytics", "Analytics");
    await expect(page.getByRole("link", { name: /^Open conversation with / }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^Download transcript of the conversation with / }).first()).toBeVisible();
    await expect(page.getByText(/Website|WhatsApp|Slack|Email/).first()).toBeVisible();
  });

  test("UI-ANL-04 [M4] date range and channel filters", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/analytics", "Analytics");
    await page.getByRole("button", { name: "30 days" }).click();
    await page.locator("#analytics-channel").selectOption({ label: "Website" });
    await expect(page.getByRole("heading", { name: "Conversation volume" })).toBeVisible();
  });

  test("UI-ANL-05 [M4] reports and improvement areas", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/analytics", "Analytics");
    await page.goto("/dashboard/analytics/reports");
    await expect(page.getByText(/frequently asked|FAQ/i).first()).toBeVisible();
    await page.goto("/dashboard/analytics/improve");
    await expect(page.getByText(/knowledge gaps|improve/i).first()).toBeVisible();
  });

  test("UI-ANL-06 [M4] exports download CSV", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/analytics", "Analytics");
    const response = await page.request.get("/api/analytics/export?type=interactions");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("text/csv");
  });
});
