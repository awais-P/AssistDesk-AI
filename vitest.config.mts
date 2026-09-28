import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      // Modules that import the Prisma client need a URL; unit tests never query it.
      DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
      ASSISTDESK_ENCRYPTION_KEY: "unit-test-encryption-key-0123456789",
    },
  },
});
