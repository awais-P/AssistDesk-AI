import { mkdirSync } from "node:fs";
import { request, type FullConfig } from "@playwright/test";
import { ADMIN_EMAIL, adminPassword } from "./helpers";

/** Signs the demo admin in once and saves the session cookie for every test. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL ?? "http://localhost:3000";
  const context = await request.newContext({ baseURL });
  const response = await context.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: adminPassword() },
    timeout: 120_000,
  });

  if (!response.ok()) {
    throw new Error(`Admin sign-in failed (${response.status()}). Is the server running with ASSISTDESK_SEED_DEMO=true?`);
  }

  mkdirSync("tests/ui/.auth", { recursive: true });
  await context.storageState({ path: "tests/ui/.auth/admin.json" });
  await context.dispose();
}
