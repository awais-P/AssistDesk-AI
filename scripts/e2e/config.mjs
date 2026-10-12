// Settings for the end-to-end scripts. Everything comes from the environment so no credentials
// live in the repo. Run them only against a development server with a throwaway database.
function required(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    console.error(`Missing ${name}. See scripts/e2e/README.md.`);
    process.exit(2);
  }

  return value;
}

export const E2E = {
  /** The running dev server (npm run dev). */
  baseUrl: process.env.E2E_BASE_URL?.trim() || "http://localhost:3000",
  /** The same database the dev server uses (never production: the scripts create and change data). */
  databaseUrl: process.env.E2E_DATABASE_URL?.trim() || required("TEST_DATABASE_URL"),
  /** The seeded demo admin (ASSISTDESK_SEED_DEMO=true seeds admin@assistdesk.local). */
  adminEmail: process.env.E2E_ADMIN_EMAIL?.trim() || "admin@assistdesk.local",
  adminPassword: required("ASSISTDESK_DEMO_PASSWORD"),
  /** Must match the dev server's CRON_SECRET. */
  cronSecret: required("CRON_SECRET"),
};
