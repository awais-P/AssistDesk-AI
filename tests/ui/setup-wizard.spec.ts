import { expect, test } from "@playwright/test";
import { testClientIp, waitForHydration } from "./helpers";

// A brand-new account goes through the onboarding wizard.
test.use({ storageState: { cookies: [], origins: [] } });

test("UI-SETUP-01 [FR-2.1–2.5, FR-3.1–3.6, FR-4.1–4.6] onboarding wizard creates inbox, agent, knowledge and chatbot", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const response = await page.request.post("/api/auth/signup", {
    headers: { "x-forwarded-for": testClientIp() },
    data: { fullName: "Wizard Tester", email: `ui-wizard-${stamp}@example.com`, password: "UiTest-Pass-2026" },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto("/setup");
  await waitForHydration(page, "h1");
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create Your Inbox" })).toBeVisible();

  // Step 1: inbox name and email prefix with an availability check.
  await page.getByPlaceholder("Support, Sales, General").fill("Support");
  await page.getByPlaceholder("company", { exact: true }).fill(`wizard${stamp}`);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText(/available/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: AI agent.
  await expect(page.getByText("Step 2 of 4")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create AI Agent" })).toBeVisible();
  await page.getByPlaceholder("Support Assistant").fill("Wizard Assistant");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: knowledge as text; Back keeps the agent name (FR-3.5 / FR-4.5).
  await expect(page.getByRole("heading", { name: "Add Knowledge Base" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByPlaceholder("Support Assistant")).toHaveValue("Wizard Assistant");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "TEXT", exact: true }).click();
  await page.getByPlaceholder(/Paste your FAQs/).fill("Our store is open Monday to Friday, 9am to 6pm. Delivery takes 3 to 5 working days.");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4: chatbot widget.
  await expect(page.getByText("Step 4 of 4")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create Chatbot Widget" })).toBeVisible();
  await page.getByPlaceholder("Website Support Bot").fill("Wizard Bot");
  await page.getByPlaceholder("https://example.com").fill("https://wizard-shop.example.com");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("wizard-shop.example.com")).toBeVisible();
  await page.getByRole("button", { name: "Complete Setup" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
});

test("UI-SETUP-02 [FR-2.4] the inbox step requires a name", async ({ page }) => {
  const response = await page.request.post("/api/auth/signup", {
    headers: { "x-forwarded-for": testClientIp() },
    data: { fullName: "Wizard Tester", email: `ui-wizard-empty-${Date.now()}@example.com`, password: "UiTest-Pass-2026" },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto("/setup");
  await waitForHydration(page, "h1");
  await page.getByPlaceholder("Support, Sales, General").fill("");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create Your Inbox" })).toBeVisible();
});
