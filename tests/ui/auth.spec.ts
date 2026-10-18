import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, adminPassword, testClientIp, waitForHydration } from "./helpers";

// These tests start signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Authentication (FR-1)", () => {
  test("UI-AUTH-01 login and sign-up screens link to each other - FR-1.5", async ({ page }) => {
    await page.goto("/login");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "Log in to AssistDesk" })).toBeVisible();
    await expect(page.getByLabel("Username or Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Create one" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { name: "Create your AssistDesk account" })).toBeVisible();

    await page.getByRole("main").getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("UI-AUTH-02 wrong password is refused with a clear message - FR-1.3", async ({ page }) => {
    await page.goto("/login");
    await waitForHydration(page);
    await page.getByLabel("Username or Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill("not-the-password-1");
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page.getByText(/email\/username and password don't match/)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("UI-AUTH-03 sign-up validates email, password rules and confirmation - FR-1.2, FR-1.3", async ({ page }) => {
    await page.goto("/signup");
    await waitForHydration(page);
    await page.getByLabel("Full Name").fill("Test User");
    await page.getByLabel("Email Address").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm Password").fill("different1");
    await page.getByRole("button", { name: "Create Account" }).click();

    await expect(page.getByText("Please fix the highlighted fields and try again.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address, like name@company.com.")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "At least 8 characters" })).toContainText("(not met)");
    await expect(page.getByText("Passwords don't match.")).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("UI-AUTH-04 a new account is created and taken to setup - FR-1.1–1.3", async ({ page }) => {
    const email = `ui-signup-${Date.now()}@example.com`;
    await page.setExtraHTTPHeaders({ "x-forwarded-for": testClientIp() });
    await page.goto("/signup");
    await waitForHydration(page);
    await page.getByLabel("Full Name").fill("Playwright Tester");
    await page.getByLabel("Email Address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("UiTest-Pass-2026");
    await page.getByLabel("Confirm Password").fill("UiTest-Pass-2026");
    await page.getByRole("button", { name: "Create Account" }).click();

    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { name: "Welcome to AssistDesk AI" })).toBeVisible();
  });

  test("UI-AUTH-07 a sixth sign-up from one network within an hour is refused - BR-1", async ({ page }) => {
    const ip = testClientIp().replace("198.51.100.", "203.0.113.");
    await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
    const stamp = Date.now();

    for (let index = 0; index < 5; index += 1) {
      const response = await page.request.post("/api/auth/signup", {
        headers: { "x-forwarded-for": ip },
        data: { fullName: "Limit Tester", email: `ui-limit-${stamp}-${index}@example.com`, password: "UiTest-Pass-2026" },
      });
      expect(response.status()).toBe(200);
    }

    await page.context().clearCookies();
    await page.goto("/signup");
    await waitForHydration(page);
    await page.getByLabel("Full Name").fill("Limit Tester");
    await page.getByLabel("Email Address").fill(`ui-limit-${stamp}-6@example.com`);
    await page.getByLabel("Password", { exact: true }).fill("UiTest-Pass-2026");
    await page.getByLabel("Confirm Password").fill("UiTest-Pass-2026");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByText(/Too many sign-ups from this network/)).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("UI-AUTH-05 signed-out visitors are sent to the login page - SEC", async ({ page }) => {
    await page.goto("/dashboard/tickets");
    await expect(page).toHaveURL(/\/login/);
  });

  test("UI-AUTH-06 the admin signs in and reaches the dashboard - FR-1.3", async ({ page }) => {
    await page.goto("/login");
    await waitForHydration(page);
    await page.getByLabel("Username or Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(adminPassword());
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  });
});
