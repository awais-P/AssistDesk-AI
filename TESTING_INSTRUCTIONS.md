# AssistDesk Testing Instructions

This guide explains how to run the AssistDesk test suites one by one, how to
run individual tests, how to collect evidence, and how to link each result to
the Software Requirements Specification (SRS).

Use a development or throwaway database for all tests. Do not run destructive
test suites against production data.

## 1. Prerequisites

Install:

- Node.js and npm
- PostgreSQL, either locally or through Docker
- Google Chrome for the Playwright UI tests

Open PowerShell in the repository:

```powershell
cd "C:\Users\Ahmed Mujtaba\coding projects\AssistDesk-AI"
```

Install the exact dependency versions from the lockfile:

```powershell
npm ci
```

If there is no `package-lock.json`, use this once instead:

```powershell
npm install
```

Generate Prisma Client and apply migrations:

```powershell
npx prisma generate
npx prisma migrate deploy
```

## 2. Environment setup

Keep private values in `.env`. Do not commit `.env`, paste it into reports, or
share API keys and database passwords.

For local demo and Playwright testing, the development environment needs the
following settings:

```env
ASSISTDESK_SEED_DEMO=true
ASSISTDESK_DEMO_PASSWORD=<development password of at least 8 characters>
ASSISTDESK_ALLOW_PRIVATE_TOOLS=true
```

The complete HTTP end-to-end suite also expects:

```env
CRON_SECRET=<development secret>
ASSISTDESK_ALLOW_PRIVATE_WEBHOOKS=true
```

AI-dependent tests require a configured provider key, such as the project’s
Groq, Google, or OpenRouter setting. The exact key must remain private.

## 3. Start the application

Start PostgreSQL. If this project is configured for Docker PostgreSQL:

```powershell
docker compose up -d
```

Start the development server:

```powershell
npm run dev
```

Keep this terminal running. The application should be available at:

```text
http://localhost:3000
```

When demo seeding is enabled, the demo administrator is:

```text
Email: admin@assistdesk.local
Password: the value of ASSISTDESK_DEMO_PASSWORD
```

Open the application once in a browser so the development demo workspace can
be initialized.

## 4. Seed the sample store

The application’s development demo data is defined in
`src/lib/demo-data.ts`. The larger sample store used by UI and end-to-end tests
is populated by:

```powershell
node scripts/e2e/seed-demo.mjs
```

Run this command from a second PowerShell window while the development server
is running. The sample data includes customers, conversations, tickets, leads,
appointments, knowledge-base content, and demo tools.

The UI tests expect records such as `Ali Raza`, `Hina Shah`, `Usman Tariq`, and
the store-policy knowledge source.

## 5. Test command overview

The commands are defined in `package.json`:

| Purpose | Command |
|---|---|
| Unit tests, one run | `npm test` |
| Unit tests, watch mode | `npm run test:watch` |
| Integration tests | `npm run test:integration` |
| Playwright UI tests | `npm run test:ui` |
| Lint | `npm run lint` |
| Production build | `npm run build` |

The normal complete validation sequence is:

```powershell
npm test
npm run test:integration
npm run test:ui
npm run lint
npm run build
```

Run the commands separately so that a failure can be attributed to the correct
test layer.

## 6. Unit tests

Unit tests are located in `tests/unit/`. They test isolated business logic and
do not normally require a running server:

```powershell
npm test
```

Run one unit test file:

```powershell
npx vitest run tests/unit/auth-and-rbac.test.ts
```

Run multiple focused files:

```powershell
npx vitest run `
  tests/unit/auth-and-rbac.test.ts `
  tests/unit/widget-security.test.ts `
  tests/unit/secrets.test.ts
```

Run tests whose names match a pattern:

```powershell
npx vitest run -t "password"
```

Run a file in watch mode:

```powershell
npx vitest tests/unit/auth-and-rbac.test.ts
```

Run unit tests with coverage:

```powershell
npx vitest run --coverage
```

If coverage support is not installed, use the normal unit test command and
install only the coverage dependency requested by Vitest.

### Unit test areas

| Area | File |
|---|---|
| Agent and integration configuration | `tests/unit/agent-and-integration-config.test.ts` |
| Analytics | `tests/unit/analytics.test.ts` |
| Authentication and RBAC | `tests/unit/auth-and-rbac.test.ts` |
| Channel signatures | `tests/unit/channel-signatures.test.ts` |
| Knowledge ingestion | `tests/unit/knowledge-ingestion.test.ts` |
| Knowledge retrieval | `tests/unit/knowledge-retrieval.test.ts` |
| Leads | `tests/unit/leads.test.ts` |
| Safe fetch | `tests/unit/safe-fetch.test.ts` |
| Secrets | `tests/unit/secrets.test.ts` |
| Sessions and memory | `tests/unit/sessions-and-memory.test.ts` |
| Tools | `tests/unit/tools.test.ts` |
| Widget security | `tests/unit/widget-security.test.ts` |

## 7. Integration tests

Integration tests are in `tests/integration/` and use a database and real
application services. Use a separate throwaway PostgreSQL database with
migrations applied.

Run the complete integration suite:

```powershell
npm run test:integration
```

Run one integration file:

```powershell
npx vitest run `
  --config vitest.integration.config.mts `
  tests/integration/ticket-workflow.int.ts
```

Run several integration files:

```powershell
npx vitest run `
  --config vitest.integration.config.mts `
  tests/integration/action-logs.int.ts `
  tests/integration/tools.int.ts
```

Run one integration test by name:

```powershell
npx vitest run `
  --config vitest.integration.config.mts `
  -t "ticket"
```

Integration test files:

| Area | File |
|---|---|
| Action logs | `tests/integration/action-logs.int.ts` |
| Agent engine | `tests/integration/agent-engine.int.ts` |
| Real model behavior | `tests/integration/real-model.int.ts` |
| Ticket workflow | `tests/integration/ticket-workflow.int.ts` |
| Tool administration | `tests/integration/tool-admin.int.ts` |
| Tools | `tests/integration/tools.int.ts` |

If the integration suite reports a missing database variable, configure the
throwaway database connection expected by the project’s integration config
before rerunning it. Never point this variable at production.

## 8. Playwright UI tests

Playwright tests are in `tests/ui/` and drive the running application in
Chrome. They use one worker because tests share the demo workspace.

Run all UI tests:

```powershell
npm run test:ui
```

Run with the browser visible:

```powershell
npx playwright test --headed
```

Run in debug mode:

```powershell
npx playwright test --debug
```

If the browser binary is missing:

```powershell
npx playwright install
```

The configuration uses Chrome. Make sure Google Chrome is installed.

Set a different application URL for testing:

```powershell
$env:E2E_BASE_URL = "http://localhost:3000"
npm run test:ui
```

Run one UI file:

```powershell
npx playwright test tests/ui/tickets.spec.ts
```

Run one test by its test ID:

```powershell
npx playwright test -g "UI-TKT-04"
```

Other examples:

```powershell
npx playwright test -g "UI-AUTH-06"
npx playwright test -g "UI-KB-03"
npx playwright test -g "UI-ANL-06"
```

Run tests matching a feature:

```powershell
npx playwright test -g "chatbot"
npx playwright test -g "knowledge"
```

Run with a specific reporter:

```powershell
npx playwright test --reporter=list
npx playwright test --reporter=line
npx playwright test --reporter=html
```

Open the HTML report after a run:

```powershell
npx playwright show-report
```

Playwright writes JSON results to:

```text
test-results/ui-results.json
```

Screenshots and traces are retained for failed tests according to
`playwright.config.ts`. Open a trace with:

```powershell
npx playwright show-trace path\to\trace.zip
```

### Playwright SRS mapping

Each UI test title includes its test ID and SRS requirement IDs:

| SRS area | File | Test IDs |
|---|---|---|
| FR-1 Authentication | `tests/ui/auth.spec.ts` | `UI-AUTH-01` to `UI-AUTH-07` |
| FR-2 to FR-4 Setup | `tests/ui/setup-wizard.spec.ts` | `UI-SETUP-01` to `UI-SETUP-02` |
| FR-5 Tickets | `tests/ui/tickets.spec.ts` | `UI-TKT-01` to `UI-TKT-08` |
| FR-6 Chats | `tests/ui/chats.spec.ts` | `UI-CHT-01` to `UI-CHT-03` |
| FR-7 and FR-8 Agents | `tests/ui/agents.spec.ts` | `UI-AGT-01` to `UI-AGT-06` |
| FR-9 Prompts | `tests/ui/prompts.spec.ts` | `UI-PRM-01` to `UI-PRM-03` |
| FR-10 Knowledge base | `tests/ui/knowledge-base.spec.ts` | `UI-KB-01` to `UI-KB-05` |
| FR-11 Analytics | `tests/ui/analytics.spec.ts` | `UI-ANL-01` to `UI-ANL-06` |
| FR-12 to FR-14 Chatbots | `tests/ui/chatbots.spec.ts` | `UI-BOT-01` to `UI-BOT-05` |
| FR-15 Inbox | `tests/ui/inbox-integrations.spec.ts` | `UI-INB-01` to `UI-INB-03` |
| FR-16 Integrations | `tests/ui/inbox-integrations.spec.ts` | `UI-INT-01` to `UI-INT-02` |
| FR-17 Widget | `tests/ui/widget.spec.ts` | `UI-WID-01` to `UI-WID-06` |
| Module 2 Tools | `tests/ui/agentic-tools.spec.ts` | `UI-M2-01` to `UI-M2-05` |
| Module 8 Leads | `tests/ui/leads.spec.ts` | `UI-LED-01` to `UI-LED-04` |

The full descriptions and requirement references are also in
`tests/ui/README.md`.

## 9. HTTP end-to-end suite

The scripts in `scripts/e2e/` test the running application over HTTP and cover
multiple modules.

Run all HTTP end-to-end checks:

```powershell
node scripts/e2e/e2e-all.mjs
```

Run without AI calls:

```powershell
node scripts/e2e/e2e-all.mjs --skip-ai
```

Run Module 2:

```powershell
node scripts/e2e/setup-m2.mjs
node scripts/e2e/e2e-m2.mjs
```

These scripts need the environment variables documented in
`scripts/e2e/README.md`, including a throwaway database, the demo password,
the cron secret, and a running development server.

The result file is:

```text
scripts/e2e/e2e-all.results.json
```

Each check prints `PASS` or `FAIL`, and the process exits with a non-zero code
when a check fails.

## 10. Lint and build validation

Run ESLint:

```powershell
npm run lint
```

Build the production application:

```powershell
npm run build
```

Start the production build only after the build succeeds:

```powershell
npm run start
```

Lint and build success do not replace functional testing; they only confirm
code quality and production compilation.

## 11. Manual SRS verification

Use the SRS document to verify the requirement itself, not only whether a test
is green.

For every requirement:

1. Find the requirement ID in the SRS.
2. Copy its expected behavior into your test record.
3. Find the matching automated test ID in the test title or mapping above.
4. Run the matching test.
5. Repeat the same flow manually in the browser.
6. Check validation, error states, persistence, permissions, and navigation.
7. Capture a screenshot or downloaded file as evidence.
8. Record the actual result and mark the requirement Pass or Fail.

Use this test record format:

| Test ID | SRS ID | Requirement | Preconditions | Steps | Expected result | Actual result | Evidence | Status |
|---|---|---|---|---|---|---|---|---|
| UI-TKT-04 | FR-5.x | Create a ticket | Demo data and admin login | Create and save a ticket | Ticket appears in the list |  | `UI-TKT-04.png` | Pass/Fail |

A test should be marked **Pass** only when:

- The automated test passes, when an automated test exists.
- The manual behavior matches the SRS.
- The expected data is visible or persisted.
- Error and validation behavior is correct.
- There is sufficient evidence to reproduce the result.

Mark an item **Blocked** instead of Pass when it cannot run because of a
missing database, unavailable provider, missing demo data, or another
environment problem.

## 12. Troubleshooting

### Admin sign-in fails during Playwright setup

Check that:

- The development server is running.
- `ASSISTDESK_SEED_DEMO=true` is enabled.
- The demo password is at least eight characters.
- The test password matches the server password.
- Database migrations have been applied.
- The browser is using the same `E2E_BASE_URL` as the server.

### Playwright reports missing browsers

```powershell
npx playwright install
```

### Tests cannot find expected records

Run the sample-store seed while the server is running:

```powershell
node scripts/e2e/seed-demo.mjs
```

### AI checks fail or time out

Confirm that a supported development AI provider is configured. You can run
the HTTP end-to-end suite without AI checks:

```powershell
node scripts/e2e/e2e-all.mjs --skip-ai
```

An AI-dependent test should not be marked Pass if it was skipped.

### Need a clean local database

This deletes the Docker database volume and all local data:

```powershell
docker compose down -v
docker compose up -d
npx prisma migrate deploy
```

Only use this when a clean reset is intentional.

## 13. Final reporting checklist

Before declaring the project verified, record:

- Unit test result
- Integration test result
- Playwright UI test result
- HTTP end-to-end result
- Lint result
- Production build result
- Any skipped or blocked tests
- SRS requirement IDs covered by each test
- Screenshots, traces, downloads, or JSON reports used as evidence
- Environment limitations, such as unavailable AI providers

Recommended summary:

```text
Unit tests: PASS / FAIL
Integration tests: PASS / FAIL / BLOCKED
Playwright UI tests: PASS / FAIL / BLOCKED
HTTP end-to-end tests: PASS / FAIL / BLOCKED
Lint: PASS / FAIL
Production build: PASS / FAIL
SRS requirements passed: <number>
SRS requirements failed: <number>
SRS requirements blocked: <number>
```
