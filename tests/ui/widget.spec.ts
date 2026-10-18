import { expect, test, type Browser, type Page } from "@playwright/test";
import { EMBEDDING_PAGE, WIDGET_ID, newVisitorContext, sendVisitorMessage, waitForHydration } from "./helpers";

/** Opens the widget as an anonymous visitor on an allowed website. */
async function openWidget(browser: Browser, referer = EMBEDDING_PAGE): Promise<Page> {
  const context = await newVisitorContext(browser, referer);
  const page = await context.newPage();
  await page.goto(`/widget/${WIDGET_ID}`, { referer });
  if (referer === EMBEDDING_PAGE) {
    await waitForHydration(page);
  }
  return page;
}

test.describe("Website chat widget (FR-17, M1, M5)", () => {
  test("UI-WID-01 header, welcome message and branding - FR-17.1, FR-17.2, FR-17.9", async ({ browser }) => {
    const widget = await openWidget(browser);
    await expect(widget.getByText("Website Support Bot")).toBeVisible();
    await expect(widget.getByText(/^Online/)).toBeVisible();
    await expect(widget.getByText("Hello, how can I help you today?")).toBeVisible();
    await expect(widget.getByText(/Powered by\s*AssistDesk AI/)).toBeVisible();
    await widget.context().close();
  });

  test("UI-WID-02 a visitor question gets a grounded AI answer - FR-17.3, FR-17.4, FR-17.6, FR-17.7, M10 RAG", async ({ browser }) => {
    test.setTimeout(180_000);
    const widget = await openWidget(browser);
    await sendVisitorMessage(widget, "How long is the warranty on the kettle?");
    // The answer comes from the store-policy knowledge source (3-year warranty).
    await expect(widget.getByText(/3\W?year/i).first()).toBeVisible({ timeout: 120_000 });
    // Once the server has accepted the message it shows a delivery tick.
    await expect(widget.getByRole("img", { name: "Delivered" }).first()).toBeVisible();
    await expect(widget.getByRole("group", { name: "Was this answer helpful?" }).first()).toBeVisible();
    await widget.context().close();
  });

  test("UI-WID-03 the inline email card validates and saves the visitor's email - FR-17.5", async ({ browser }) => {
    test.setTimeout(180_000);
    const widget = await openWidget(browser);
    await sendVisitorMessage(widget, "Hi, I have a question about delivery.");
    const card = widget.getByText("Get notified when we reply");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await widget.getByRole("textbox", { name: "Your email" }).fill("not-an-email");
    await widget.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(widget.getByText(/valid email/i)).toBeVisible();
    await widget.getByRole("textbox", { name: "Your email" }).fill(`visitor.${Date.now()}@example.com`);
    await widget.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(card).toBeHidden();
    await widget.context().close();
  });

  test("UI-WID-04 attachment, voice and emoji controls - FR-17.8", async ({ browser }) => {
    const widget = await openWidget(browser);
    await expect(widget.getByRole("button", { name: "Attach file" })).toBeVisible();
    await expect(widget.getByRole("button", { name: "Voice typing" })).toBeVisible();
    await widget.getByRole("button", { name: "Insert emoji" }).click();
    const picker = widget.getByRole("dialog", { name: "Emoji picker" });
    await expect(picker).toBeVisible();
    await picker.getByRole("button").first().click();
    await expect(widget.getByRole("textbox", { name: "Type your message" })).not.toHaveValue("");
    await widget.context().close();
  });

  test("UI-WID-05 a website that is not allowed cannot load the widget - FR-4.3, FR-13.4", async ({ browser }) => {
    const widget = await openWidget(browser, "https://not-allowed.example.com/page");
    await expect(widget.getByText(/This website is not allowed to load this chat widget/)).toBeVisible();
    await expect(widget.getByRole("textbox", { name: "Type your message" })).toHaveCount(0);
    await widget.context().close();
  });

  test("UI-WID-06 an agent takes over a live chat and the visitor sees the reply - FR-6.4, FR-6.5, M5 takeover", async ({ browser, page }) => {
    test.setTimeout(240_000);
    // A single unique word, so the dashboard search (by message content, FR-6.3) finds exactly this chat.
    const marker = `takeover${Date.now().toString(36)}`;
    const widget = await openWidget(browser);
    // Waits for the server's answer: only then does the widget hold its session and listen for
    // live replies (a team reply sent before that would reach it only after the AI has answered).
    await sendVisitorMessage(widget, `Hello, do you sell toasters? Ref ${marker}`);

    // Agent side (signed-in admin).
    await page.goto("/dashboard/chats");
    await waitForHydration(page);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByLabel("Search conversations").fill(marker);
    const conversations = page.getByRole("complementary", { name: "Conversations" });
    await expect(conversations.getByRole("button", { name: /^Visitor/ })).toHaveCount(1);
    await conversations.getByRole("button", { name: /^Visitor/ }).click();
    await expect(page.getByText(`Hello, do you sell toasters? Ref ${marker}`).last()).toBeVisible();
    await page.getByRole("button", { name: "Take over" }).click();
    // In development mode the session route may be compiled on this first request.
    await expect(page.getByRole("button", { name: "Hand back to AI" })).toBeVisible({ timeout: 60_000 });

    const reply = `Hi, this is Sana from support (${marker}).`;
    const composer = page.getByRole("textbox", { name: /^Reply to / });
    await composer.fill(reply);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(reply)).toBeVisible();

    // Visitor side: the agent's reply arrives without a reload (SSE).
    await expect(widget.getByText(reply)).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: "Hand back to AI" }).click();
    await expect(page.getByRole("button", { name: "Take over" })).toBeVisible({ timeout: 60_000 });
    await widget.context().close();
  });
});
