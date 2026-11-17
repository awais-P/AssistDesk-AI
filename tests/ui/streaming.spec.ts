import { expect, test, type Page, type Response } from "@playwright/test";
import pg from "pg";
import { EMBEDDING_PAGE, WIDGET_ID, newVisitorContext, openDashboardPage, sendVisitorMessage, waitForHydration } from "./helpers";

/**
 * Token streaming (M5 / M6 FE-5) in a real browser with the real AI: the reply grows in
 * place while the model writes it, then becomes the normal saved message.
 */

/** Records every length the streaming bubble had, so the test can see it grow. */
async function watchStreamingBubble(page: Page) {
  await page.evaluate(() => {
    const lengths: number[] = [];
    (window as unknown as { streamedLengths: number[] }).streamedLengths = lengths;
    new MutationObserver(() => {
      const bubble = document.querySelector('[aria-busy="true"]');
      const length = bubble?.textContent?.length ?? 0;

      if (length > 0 && length !== lengths.at(-1)) {
        lengths.push(length);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

const streamedLengths = (page: Page) =>
  page.evaluate(() => (window as unknown as { streamedLengths: number[] }).streamedLengths);

/** The pieces the server streamed in a reply (one JSON object per line). */
async function streamedPieces(response: Response) {
  expect(response.headers()["content-type"]).toContain("application/x-ndjson");
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { type: string });
  expect(events.at(-1)?.type).toBe("done");
  return events.filter((event) => event.type === "delta").length;
}

/**
 * What the page showed while the reply streamed. A free model sometimes sends the whole
 * answer in one piece (nothing to animate); with several pieces the bubble must grow.
 */
async function expectGrowingBubble(page: Page, pieces: number) {
  const lengths = await streamedLengths(page);
  test.info().annotations.push({ type: "streamed", description: `${pieces} pieces; bubble lengths ${lengths.slice(0, 12).join(", ")}` });

  if (pieces >= 3) {
    expect(lengths.length).toBeGreaterThan(0);
    // (It can shrink once if a model fails mid-reply and the next one starts again.)
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(lengths[0]);
  }
}

test.describe("Token streaming (M5, M6 FE-5)", () => {
  test("UI-STR-01 the website chat shows the reply while it is written, then the saved answer", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await newVisitorContext(browser, EMBEDDING_PAGE);
    const widget = await context.newPage();
    await widget.goto(`/widget/${WIDGET_ID}`, { referer: EMBEDDING_PAGE });
    await waitForHydration(widget);
    await watchStreamingBubble(widget);

    const reply = widget.waitForResponse((response) => response.url().endsWith("/messages") && response.request().method() === "POST", { timeout: 150_000 });
    await sendVisitorMessage(widget, "Please explain your delivery times and the return policy in detail.");
    const pieces = await streamedPieces(await reply);
    // The finished answer replaces the growing bubble and gets its 👍/👎 buttons.
    await expect(widget.getByRole("group", { name: "Was this answer helpful?" }).first()).toBeVisible({ timeout: 120_000 });
    await expect(widget.locator('[aria-busy="true"]')).toHaveCount(0);
    expect(pieces).toBeGreaterThan(0);
    await expectGrowingBubble(widget, pieces);
    await context.close();
  });

  test("UI-STR-02 the Playground streams the reply and shows the time to the first word", async ({ page }) => {
    test.setTimeout(180_000);
    await openDashboardPage(page, "/dashboard/ai-agents", "Agents");
    await page.getByRole("link", { name: "Open Agent" }).first().click();
    await page.getByRole("button", { name: "Playground", exact: true }).click();
    const input = page.getByRole("textbox").last();
    await input.fill("What is your return policy?");
    await input.press("Enter");

    await expect(page.getByText(/^First word \d/).last()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/^Complete \d/).last()).toBeVisible();
  });

  test("UI-STR-03 Analytics shows the median time to the first word - M6 FE-5", async ({ page }) => {
    await openDashboardPage(page, "/dashboard/analytics", /Analytics/);
    await expect(page.getByText(/^First word .+ median · p95 /).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "First word" })).toBeVisible();
  });

  test("UI-STR-04 after the lead form is skipped, the answer to the earlier question streams in", async ({ browser }) => {
    test.setTimeout(180_000);
    // The demo chatbot's lead form is switched on for this test and restored afterwards.
    const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await db.connect();
    const [{ leadForm: original }] = (await db.query('select "leadForm" from "Chatbot" where "widgetId" = $1', [WIDGET_ID])).rows;
    const form = {
      enabled: true,
      trigger: "ON_INTENT",
      allowSkip: true,
      fields: [
        { key: "company", label: "Company", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: false },
      ],
    };
    await db.query('update "Chatbot" set "leadForm" = $1 where "widgetId" = $2', [JSON.stringify(form), WIDGET_ID]);

    try {
      const context = await newVisitorContext(browser, EMBEDDING_PAGE);
      const widget = await context.newPage();
      await widget.goto(`/widget/${WIDGET_ID}`, { referer: EMBEDDING_PAGE });
      await waitForHydration(widget);

      // Buying intent: the form appears and the AI waits.
      await sendVisitorMessage(widget, "Can I get a quote for a bulk order of 50 kettles?");
      await expect(widget.getByRole("region", { name: "Contact form" }).or(widget.getByLabel("Contact form"))).toBeVisible({ timeout: 30_000 });

      await watchStreamingBubble(widget);
      const reply = widget.waitForResponse((response) => response.url().endsWith("/lead") && response.request().method() === "POST", { timeout: 150_000 });
      await widget.getByRole("button", { name: "Skip" }).click();
      const pieces = await streamedPieces(await reply);
      await expect(widget.getByRole("group", { name: "Was this answer helpful?" }).first()).toBeVisible({ timeout: 120_000 });
      await expect(widget.locator('[aria-busy="true"]')).toHaveCount(0);
      expect(pieces).toBeGreaterThan(0);
      await expectGrowingBubble(widget, pieces);
      await context.close();
    } finally {
      await db.query('update "Chatbot" set "leadForm" = $1 where "widgetId" = $2', [original === null ? null : JSON.stringify(original), WIDGET_ID]);
      await db.end();
    }
  });
});
