import { expect, test } from "@playwright/test";
import { EMBEDDING_PAGE, WIDGET_ID, newVisitorContext, openDashboardPage, sendVisitorMessage, unique, waitForHydration } from "./helpers";

test.describe("Support escalation (M9)", () => {
  test("UI-ESC-01 a visitor who asks for a person is told so and lands in the team's queue - M9 FE-1, FE-3", async ({ browser, page }) => {
    const visitor = await newVisitorContext(browser);
    const widget = await visitor.newPage();
    const request = `I want to talk to a human please ${unique("ref")}`;
    await widget.goto(`/widget/${WIDGET_ID}`, { referer: EMBEDDING_PAGE });
    await waitForHydration(widget);
    await sendVisitorMessage(widget, request);
    // No AI reply: the hand-over notice comes back with the message.
    await expect(widget.getByText(/connecting you with a member of our team/i)).toBeVisible();

    await openDashboardPage(page, "/dashboard/escalations", "Escalations");
    const card = page.getByRole("article").filter({ hasText: request.slice(-20) });
    await expect(card).toBeVisible();
    await expect(card.getByText("Asked for a person", { exact: true })).toBeVisible();
    await expect(card.getByText(/Accept within \d+ min/)).toBeVisible();
    await expect(card.getByText(/^Issue:|AI is writing/).first()).toBeVisible();
    await visitor.close();
  });

  test("UI-ESC-02 accepting and handing back to the AI - M9 FE-4, FE-6", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/escalations", "Escalations");
    const card = page.getByRole("article").filter({ hasText: "Asked for a person" }).first();
    await card.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByRole("status").filter({ hasText: "You accepted the escalation" })).toBeVisible();

    await page.getByRole("button", { name: "Mine", exact: true }).click();
    const mine = page.getByRole("article").filter({ hasText: "You are handling this" }).first();
    await expect(mine).toBeVisible();
    await mine.getByRole("button", { name: "Resolve" }).click();
    await mine.getByLabel("Hand back to the AI").check();
    await mine.getByLabel(/Note for the record/).fill("Answered by the team");
    await mine.getByRole("button", { name: "Resolve escalation" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Escalation resolved" })).toBeVisible();
  });

  test("UI-ESC-03 escalation settings are saved - M9 FE-1, FE-3", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/escalations/settings", "Escalation settings");
    const sla = page.getByLabel(/Response time \(SLA\)/);
    await sla.fill("20");
    await page.getByLabel("Your own trigger phrases").fill("warranty claim");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Escalation settings saved" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/Response time \(SLA\)/)).toHaveValue("20");
    // Back to the defaults for the other tests.
    await page.getByLabel(/Response time \(SLA\)/).fill("15");
    await page.getByLabel("Your own trigger phrases").fill("");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Escalation settings saved" })).toBeVisible();
  });

  test("UI-ESC-04 escalations download as CSV - M9 FE-4", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/escalations", "Escalations");
    const response = await page.request.get("/api/escalations?view=all&format=csv");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(await response.text()).toContain("Asked for a person");
  });
});
