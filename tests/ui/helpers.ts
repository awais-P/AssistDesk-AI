import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@assistdesk.local";
export const WIDGET_ID = process.env.E2E_WIDGET_ID ?? "assistdesk-widget-demo";
/** A site in the demo chatbot's allowed domains (localhost) that is not the app itself. */
export const EMBEDDING_PAGE = process.env.E2E_EMBEDDING_PAGE ?? "http://localhost:8080/shop";

export function adminPassword() {
  const password = process.env.ASSISTDESK_DEMO_PASSWORD;

  if (!password) {
    throw new Error("Set ASSISTDESK_DEMO_PASSWORD to the demo admin password used by the server.");
  }

  return password;
}

/** Unique suffix so repeated runs never collide. */
export function unique(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

/**
 * A random documentation-range address. Sign-up is limited per client IP (5 per hour),
 * so each test that creates an account presents its own address via X-Forwarded-For.
 */
export function testClientIp() {
  return `198.51.100.${1 + Math.floor(Math.random() * 254)}`;
}

/** Accepts the next window.confirm() dialog (used before deletes). */
export function acceptNextConfirm(page: Page) {
  page.once("dialog", (dialog) => dialog.accept());
}

/**
 * Waits until React has hydrated the server-rendered page. Typing into an input before that
 * is lost (the DOM shows the text but the component state never receives it), which is easy
 * to hit in development mode where hydration is slow.
 */
export async function waitForHydration(page: Page, selector = "main") {
  await page.waitForFunction(
    (css) => {
      const element = document.querySelector(css);
      return !!element && Object.keys(element).some((key) => key.startsWith("__reactFiber"));
    },
    selector,
    { timeout: 60_000 },
  );
}

export async function openDashboardPage(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await waitForHydration(page, "main h1");
}

/**
 * Makes sure the assistant has answered at least once recently, for screens that only show
 * the last 24 hours (e.g. the latency chart). Asks the demo widget one question as a visitor.
 */
/**
 * A signed-out browser context for one widget visitor on the website `referer`.
 *
 * Headers are added only to the requests that need them: Chrome does not deliver a
 * Server-Sent Events response to a page whose context adds headers to every request.
 * - The widget page always carries the embedding website as its Referer, also when the
 *   development server reloads the page after compiling a route (the reload has no Referer,
 *   so the widget would otherwise refuse to load).
 * - The server allows 10 new widget conversations per client address per hour, and every
 *   test reaches it from localhost, so each visitor presents its own address.
 */
export async function newVisitorContext(browser: Browser, referer = EMBEDDING_PAGE): Promise<BrowserContext> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const address = testClientIp();
  await context.route(`**/widget/${WIDGET_ID}`, (route) =>
    route.continue({ headers: { ...route.request().headers(), referer } }),
  );
  await context.route("**/api/widget/*/messages", (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": address } }),
  );
  return context;
}

/**
 * Sends a visitor message and waits until the server has accepted it. The message is shown
 * at once, even if the server refuses it (for example 429 Too Many Requests), so checking
 * the screen alone is not enough. The server answers after the AI reply, which can take
 * a while on free-tier models.
 */
export async function sendVisitorMessage(page: Page, text: string) {
  const accepted = page.waitForResponse(
    (response) => response.url().includes("/api/widget/") && response.url().endsWith("/messages") && response.request().method() === "POST",
    { timeout: 150_000 },
  );
  await page.getByRole("textbox", { name: "Type your message" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(text)).toBeVisible();
  const response = await accepted;
  expect(response.status(), `the server refused the visitor message: ${await response.text()}`).toBe(200);
}

export async function ensureRecentAiReply(browser: Browser) {
  const context = await newVisitorContext(browser);
  const widget = await context.newPage();
  await widget.goto(`/widget/${WIDGET_ID}`, { referer: EMBEDDING_PAGE });
  await waitForHydration(widget);
  await sendVisitorMessage(widget, "What is your returns policy?");
  // Only replies from the assistant carry the "Was this answer helpful?" buttons.
  await expect(widget.getByRole("group", { name: "Was this answer helpful?" }).first()).toBeVisible({ timeout: 120_000 });
  await context.close();
}
