// Starts the demo / test environment in one step:
//   1. checks the demo database (TEST_DATABASE_URL in .env.demo) is reachable,
//   2. applies the migrations to it,
//   3. starts AssistDesk on DEMO_PORT with the demo settings, building into .next-test,
//   4. signs in once so the demo admin and demo chatbot are created,
//   5. loads the sample store (scripts/e2e/seed-demo.mjs) if it is not there yet.
// Then keep this window open; Ctrl+C stops the server.
//
//   npm run demo
//
// Settings: .env.demo (copy .env.demo.example the first time). Never point it at production.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ENV_FILE = `${ROOT}.env.demo`;

function fail(message) {
  console.error(`\n[demo] ${message}\n`);
  process.exit(1);
}

if (!existsSync(ENV_FILE)) {
  fail("Missing .env.demo. Create it once with:  Copy-Item .env.demo.example .env.demo  and fill in your values.");
}
process.loadEnvFile(ENV_FILE);

for (const name of ["TEST_DATABASE_URL", "ASSISTDESK_DEMO_PASSWORD", "CRON_SECRET"]) {
  if (!process.env[name] || process.env[name].includes("<")) {
    fail(`Set ${name} in .env.demo.`);
  }
}
if (process.env.ASSISTDESK_DEMO_PASSWORD.length < 8) {
  fail("ASSISTDESK_DEMO_PASSWORD in .env.demo must be at least 8 characters.");
}

const port = process.env.DEMO_PORT || "3100";
const base = `http://localhost:${port}`;
const database = process.env.TEST_DATABASE_URL;
const serverEnv = {
  ...process.env,
  DATABASE_URL: database,
  E2E_BASE_URL: base,
  NEXT_PUBLIC_APP_URL: base,
  NEXT_DIST_DIR: ".next-test",
  ASSISTDESK_SEED_DEMO: "true",
  // Reading real mailboxes (Gmail) is off for the demo/test server unless .env.demo sets
  // ASSISTDESK_EMAIL_POLLING=true (for a live email demo).
  ASSISTDESK_EMAIL_POLLING: process.env.ASSISTDESK_EMAIL_POLLING === "true" ? "true" : "false",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function query(sql) {
  const client = new pg.Client({ connectionString: database });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

// 1. Database
console.log(`[demo] Checking the demo database…`);
try {
  await query("select 1");
} catch (error) {
  fail(`Cannot reach TEST_DATABASE_URL (${error.message}). Start the database first (e.g. docker compose up -d).`);
}

// 2. Migrations
console.log("[demo] Applying migrations…");
const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], { cwd: ROOT, env: serverEnv, stdio: "inherit", shell: true });
if (migrate.status !== 0) {
  fail("prisma migrate deploy failed (see above).");
}

// 3. Server
const portBusy = await fetch(base, { signal: AbortSignal.timeout(2000) }).then(() => true).catch(() => false);
if (portBusy) {
  fail(`Port ${port} is already in use. Stop the program using it, or set DEMO_PORT in .env.demo.`);
}
console.log(`[demo] Starting AssistDesk on ${base} …`);
const server = spawn("npx", ["next", "dev", "-p", port], { cwd: ROOT, env: serverEnv, stdio: "inherit", shell: true });

function stopServer() {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    server.kill("SIGTERM");
  }
}
process.on("SIGINT", () => {
  stopServer();
  process.exit(0);
});
server.on("exit", (code) => {
  console.log(`[demo] Server stopped (${code ?? "signal"}).`);
  process.exit(code ?? 0);
});

let ready = false;
for (let attempt = 0; attempt < 150 && !ready; attempt += 1) {
  ready = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) }).then((response) => response.ok).catch(() => false);
  if (!ready) await sleep(2000);
}
if (!ready) {
  stopServer();
  fail(`The server did not answer on ${base} within 5 minutes.`);
}

// 4. Demo admin and demo chatbot (created on the first sign-in)
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.200" },
  body: JSON.stringify({ email: "admin@assistdesk.local", password: process.env.ASSISTDESK_DEMO_PASSWORD }),
});
if (!login.ok) {
  console.warn(`[demo] Demo sign-in returned ${login.status}. If this database already had a demo admin with another password, use that password in .env.demo.`);
}

// 5. Sample store
const [{ count }] = await query(`select count(*)::int as count from "Contact" where email = 'ali.raza@example.com'`);
if (count === 0) {
  console.log("[demo] Loading the sample store (real AI chats; takes a few minutes)…");
  const seed = spawnSync("node", ["scripts/e2e/seed-demo.mjs"], { cwd: ROOT, env: serverEnv, stdio: "inherit", shell: true });
  if (seed.status !== 0) {
    console.warn("[demo] The sample-store seed reported a problem (see above). Tests that need it may fail.");
  }
} else {
  console.log("[demo] Sample store already loaded.");
}

console.log(`
[demo] Ready: ${base}  (sign in as admin@assistdesk.local with the password from .env.demo)
[demo] In another terminal:  npm run test:ui      (browser tests)
[demo]                       npm run test:integration
[demo] Keep this window open; Ctrl+C stops the server.
`);
