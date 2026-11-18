import { expect, test } from "@playwright/test";
import { EMBEDDING_PAGE, WIDGET_ID, newVisitorContext, sendVisitorMessage, unique, waitForHydration } from "./helpers";

// A 1×1 PNG for the attachment test.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

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
    // Search too: newer website chats (other tests) can push the seeded ones off the first page.
    await page.getByLabel("Search conversations").fill("Ali Raza");
    await expect(page.getByRole("button", { name: /Ali Raza/ }).first()).toBeVisible();
  });

  test("UI-CHT-04 the agent sees the visitor online and replies with a file and an emoji - FR-6.1, FR-6.2, FR-6.6, FR-6.7", async ({ page, browser }) => {
    test.setTimeout(180_000);
    // A visitor with the chat open.
    const name = unique("Visitor");
    const visitorContext = await newVisitorContext(browser, EMBEDDING_PAGE);
    const widget = await visitorContext.newPage();
    await widget.goto(`/widget/${WIDGET_ID}`, { referer: EMBEDDING_PAGE });
    await waitForHydration(widget);
    await sendVisitorMessage(widget, `Hi, this is ${name}. Can someone send me the size chart?`);

    // The agent finds the conversation (search covers message text): avatar with the online dot.
    await page.goto("/dashboard/chats");
    await waitForHydration(page);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByLabel("Search conversations").fill(name);
    const conversations = page.getByRole("complementary", { name: "Conversations" });
    // Screen readers hear "Visitor (online now)"; sighted users see the green dot.
    const conversation = conversations.getByRole("button", { name: /^Visitor \(online now\)/ }).first();
    await expect(conversation).toBeVisible({ timeout: 30_000 });
    await expect(conversation.locator('[data-presence="online"]')).toBeVisible();
    await conversation.click();
    await expect(page.getByText("Online now", { exact: true })).toBeVisible();

    // Reply with a file and an emoji.
    await page.locator('input[type="file"]').setInputFiles({ name: "size-chart.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByRole("list", { name: "Files to send" }).getByText("size-chart.png")).toBeVisible();
    const replyBox = page.getByRole("textbox", { name: /Reply to/ });
    await replyBox.fill("Here is the size chart ");
    await page.getByRole("button", { name: "Insert emoji" }).click();
    await page.getByRole("dialog", { name: "Emoji picker" }).getByRole("button", { name: "Insert 👍" }).click();
    await expect(replyBox).toHaveValue("Here is the size chart 👍");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("list", { name: "Files to send" })).toHaveCount(0);
    await expect(page.getByText("Here is the size chart 👍").last()).toBeVisible();

    // The visitor gets the reply with the picture in the widget.
    await expect(widget.getByText("Here is the size chart 👍")).toBeVisible({ timeout: 30_000 });
    await expect(widget.getByRole("img", { name: "size-chart.png" })).toBeVisible();
    await visitorContext.close();
  });
});
