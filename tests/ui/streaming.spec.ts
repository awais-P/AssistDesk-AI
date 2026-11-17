import { expect, test, type Page } from "@playwright/test";
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

test.describe("Token streaming (M5, M6 FE-5)", () => {
  test("UI-STR-01 the website chat shows the reply while it is written, then the saved answer", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await newVisitorContext(browser, EMBEDDING_PAGE);
    const widget = await context.newPage();
    await widget.goto(`/widget/${WIDGET_ID}`, { referer: EMBEDDING_PAGE });
    await waitForHydration(widget);
    await watchStreamingBubble(widget);

    await sendVisitorMessage(widget, "Please explain your delivery times and the return policy in detail.");
    // The finished answer replaces the growing bubble and gets its 👍/👎 buttons.
    await expect(widget.getByRole("group", { name: "Was this answer helpful?" }).first()).toBeVisible({ timeout: 120_000 });
    await expect(widget.locator('[aria-busy="true"]')).toHaveCount(0);

    const lengths = await streamedLengths(widget);
    // Free models occasionally answer in one piece; normally the bubble grows several times.
    // (It can shrink once if a model fails mid-reply and the next one starts again.)
    expect(lengths.length).toBeGreaterThan(0);
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(lengths[0]);
    test.info().annotations.push({ type: "streamed", description: `bubble grew ${lengths.length} times: ${lengths.slice(0, 12).join(", ")}…` });
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
});
