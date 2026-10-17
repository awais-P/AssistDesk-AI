import { expect, type Page } from "@playwright/test";

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
