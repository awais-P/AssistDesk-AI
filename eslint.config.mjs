import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default defineConfig([
  globalIgnores([
    ".next/**",
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "app/generated/**",
    "storage/**",
    ".chrome-*/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  ...compat.extends("next/core-web-vitals", "next/typescript"),
]);
