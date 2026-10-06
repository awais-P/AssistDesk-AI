import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Integration tests: run against a real PostgreSQL database with all migrations
 * applied. Set TEST_DATABASE_URL (never point it at production). Each test file
 * creates its own workspace and deletes it afterwards.
 *
 *   TEST_DATABASE_URL=postgresql://… npm run test:integration
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    include: ["tests/integration/**/*.int.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      ASSISTDESK_ENCRYPTION_KEY: "integration-test-encryption-key-0123456789",
      // The tests' mock APIs listen on 127.0.0.1.
      ASSISTDESK_ALLOW_PRIVATE_TOOLS: "true",
      ASSISTDESK_ALLOW_PRIVATE_WEBHOOKS: "true",
    },
  },
});
