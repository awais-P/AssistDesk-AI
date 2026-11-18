# Testing Guide

This guide provides a general process for testing the application from setup
through final reporting. It covers automated tests, manual testing, SRS
traceability, test evidence, and common troubleshooting steps.

Use a development or throwaway environment. Never run tests that create,
modify, or delete data against production.

## Quick start: demo and tests

One settings file and two commands give everyone the same demo data and test results.

1. Start your database (for example `docker compose up -d`). With Docker, create the demo
   database once: `docker compose exec postgres createdb -U assistdesk assistdesk_test`.
2. Create your settings file once and fill it in (database URL, demo password, cron secret):

   ```powershell
   Copy-Item .env.demo.example .env.demo
   ```

3. Start the demo/test server and keep that window open:

   ```powershell
   npm run demo
   ```

   It applies the migrations, starts AssistDesk on `http://localhost:3100` (building into
   `.next-test`, so it can run next to `npm run dev`), creates the demo admin
   (`admin@assistdesk.local`, password from `.env.demo`) and loads the sample store the first
   time. Loading the sample store runs real AI chats, so an AI key must work in `.env`.

4. In another window, run the tests. They read `.env.demo` themselves:

   ```powershell
   npm run test:ui
   npm run test:integration
   node scripts/e2e/e2e-all.mjs
   ```

Values set in the shell (for example by `scripts/tests-env.ps1`) take priority over `.env.demo`.

## Email demo on localhost

AssistDesk emails ticket replies (including the AI's) through SMTP, and receives email through
its inbound webhook. A real mailbox cannot deliver to `localhost`, so a script plays the email
provider.

1. Fill in and uncomment the `ASSISTDESK_SMTP_*` lines in `.env.demo` (Gmail: use an App
   Password), restart `npm run demo`, and check the settings:

   ```powershell
   npm run email:test
   ```

2. Send a customer email to the demo workspace. Use your own address as the customer, so the
   AI's reply arrives in your inbox:

   ```powershell
   npm run email:receive -- --from you@gmail.com --name "Ali Raza" --subject "Where is my order 1042?" --text "Hi, when will my kettle arrive?"
   ```

   It prints the new ticket and whether the AI reply was emailed. Only confident AI answers are
   emailed; a low-confidence draft stays on the ticket for your team.

3. Reply as the customer; the email is added to the same ticket (use the ticket number printed
   in step 2):

   ```powershell
   npm run email:receive -- --from you@gmail.com --reply 123 --text "Thanks! Can you send the receipt?"
   ```

Replies your team writes on the ticket (Reply, not Internal note) are emailed the same way.

To send the email to your own account instead of the demo workspace, connect Email under
Integrations (Support Address = the inbox address, Inbox = your inbox) and add `--to`:

```powershell
npm run email:receive -- --to support@assistdesk.ai --from you@gmail.com --subject "Where is my order 1042?"
```

## 1. Prepare the environment

Open PowerShell in the project folder.

Install dependencies from the lockfile:

```powershell
npm ci
```

If no lockfile exists, create one with:

```powershell
npm install
```

Generate the database client and apply migrations when the project uses
Prisma:

```powershell
npx prisma generate
npx prisma migrate deploy
```

Keep credentials, database URLs, and API keys in `.env`. Do not commit or
share that file.

Values written in `.env` are loaded by the application, but standalone test
commands need their variables loaded into the PowerShell session. On Windows,
load the local test values before running integration, UI, or end-to-end tests.

The first time, create your own copy of the loader from the committed
template and fill in your local values:

```powershell
Copy-Item scripts/tests-env.example.ps1 scripts/tests-env.ps1
```

Then load it:

```powershell
. .\scripts\tests-env.ps1
```

The leading dot and space are required. The ignored local file sets the
database URLs, demo credentials, cron secret, local E2E URL, and private
local-test flags in one step. Run it again after opening a new PowerShell
window. Never point it at production.

For example, a PostgreSQL connection string has this general format:

```text
postgresql://username:password@localhost:5432/assistdesk_test
```

The database from `docker-compose.yml` is published on port **5433**, not 5432,
so its URL uses `localhost:5433` with the user, password and database set in
that file.

## 2. Prepare test data

Use separate data for testing. Before starting:

1. Confirm that the database is running.
2. Load the environment with `. .\scripts\tests-env.ps1`.
3. Apply database migrations if the schema changed.
4. Seed the development/demo data if the tests require it.
5. Confirm that the application can be opened and a test account can sign in.

For this project, the sample data used by UI and end-to-end tests can be
created with:

```powershell
node scripts/e2e/seed-demo.mjs
```

Run the command against a throwaway database while the development server is
running. The required environment variables are documented in
`scripts/e2e/README.md`.

## 3. Start the application

Start any required services, such as PostgreSQL or Docker:

```powershell
docker compose up -d
```

Start the development server:

```powershell
npm run dev
```

Keep the server terminal open. The default local address is:

```text
http://localhost:3000
```

Open the application once and verify that the login page and main dashboard
load before running browser tests.

## 4. Test layers

Run test layers separately so a failure can be identified correctly.

| Layer | Purpose | Typical command |
|---|---|---|
| Unit | Tests one function or module in isolation | `npm test` |
| Integration | Tests several modules working together | `npm run test:integration` |
| UI/E2E | Tests the application through a browser | `npm run test:ui` |
| HTTP E2E | Tests the running application through its APIs | `node scripts/e2e/e2e-all.mjs` |
| Static validation | Checks code quality and compilation | `npm run lint`, `npm run build` |

### Test coverage map

The test IDs in the final report map to the repository as follows:

| ID family | Test layer | Location | Main coverage |
|---|---|---|---|
| `UT-01`–`UT-49` | Unit | `tests/unit/` | Authentication, RBAC, secrets, SSRF protection, widget security, channel signatures, knowledge ingestion and retrieval, sessions and memory, leads, analytics, tool logic, Gmail mailbox parsing, and business rules BR-4 and BR-7 (`business-rules.test.ts`) |
| `UT-64` | Unit | `tests/unit/deployment.test.ts` | Production: health check, no unpayable trial when payments are off, build works without `DATABASE_URL` |
| `IT-29` | Integration | `tests/integration/sample-workspace.int.ts` | Sample workspace for a deployed site: only with `CRON_SECRET`, one of everything, verified logins that work, new passwords on a second run, delete removes everything |
| `UT-66` | Unit | `tests/unit/token-streaming.test.ts` | Token streaming: SSE reading across chunks, OpenAI-compatible / Anthropic / Google streams, first-word timeout, moderation-label guard, mid-reply model failure withdrawn, LangGraph streaming, first-word timing, NDJSON response, busy-model cooldown, cached question embeddings, unfinished Markdown closed, 40 s keep-alive, keyed models still tried when all are cooling down |
| `IT-30` | Integration | `tests/integration/token-streaming.int.ts` | Streamed widget reply (start, pieces, saved message, `firstTokenMs` stored), JSON reply unchanged without streaming, fallback when every model fails, streamed Playground reply, streamed answer after the lead form, first-word median and p95 in Analytics |
| `UT-67` | Unit | `tests/unit/voice.test.ts` | Voice: text cleaned for speech, phrase-by-phrase chunking, PCM to Web Audio, short-lived Deepgram token (key stays on the server), VAD/endpointing and PCM settings, spoken-reply instructions |
| `IT-31` | Integration | `tests/integration/voice.int.ts` | Voice calls: button only when switched on with a key, call as a VOICE conversation under the same customer, a spoken turn through the streamed AI, first-audio time stored once for the caller's own reply and shown in Analytics, token renewal, hang-up, start rate limit |
| `UT-65` | Unit | `tests/unit/brevo-email.test.ts` | Platform email over Brevo's HTTPS API when SMTP is blocked: verification and reset emails, team alerts, refused sends, nothing configured |
| `UT-61`–`UT-63` | Unit | `tests/unit/ticket-rules.test.ts`, `middleware.test.ts` | Priority-1 fixes: block-list rules and inactivity delays, safe error messages, cross-site check and security headers |
| `UT-58` | Unit | `tests/unit/billing.test.ts` | Module 3: plans and prices, trials and the effective plan, upgrade/downgrade detection, downgrade blockers, limit messages |
| `UT-54`, `UT-57`, `UT-59`, `UT-60` | Unit | `tests/unit/audit-and-permissions.test.ts` | Module 11: permission matrix and custom roles, audit redaction and filters, API key generation and validation, OpenAPI coverage, Shopify domain and order-ownership rules, HubSpot mapping |
| `UT-50`–`UT-53` | Unit | `tests/unit/escalation.test.ts` | Module 9: sentiment (English, Roman Urdu, Urdu), requests for a person, sensitive topics and trigger phrases, the escalation decision and SLA, queue stats, CSV export, settings validation, the fallback hand-over brief |
| `IT-01`–`IT-18` | Integration | `tests/integration/` | Tool registry and built-ins, HTTP tools, agent reasoning and fallbacks, intent rules, tool administration, appointments, action logs, ticket workflows, Gmail mailbox to tickets (`IT-18`), the opt-in real-model test (`IT-13`), and business rules BR-1, BR-2, BR-3 and BR-5 (`business-rules.int.ts`) using PostgreSQL |
| `IT-28` | Integration | `tests/integration/p1-fixes.int.ts` | Priority-1 fixes: webhook secret only for admins, block list, assignment, inbox auto-reply, follow-up and auto-close, Playground limits, offline new-chat email, background-job lease |
| `IT-26`–`IT-27` | Integration | `tests/integration/billing.int.ts`, `billing-stripe.int.ts` | Module 3: trial, plan limits, checkout, proration, cancellation, renewal, AI-reply limit, invoices (test provider); Stripe Checkout, signed webhooks, renewals, failed payments, plan changes and portal (fake Stripe client) |
| `IT-22`–`IT-25` | Integration | `tests/integration/audit-log.int.ts`, `public-api.int.ts`, `connectors.int.ts`, `custom-roles.int.ts` | Module 11: security & audit log, API keys and the public REST API, HubSpot/Shopify connectors (fake vendor APIs), custom roles and permissions |
| `IT-19`–`IT-21` | Integration | `tests/integration/escalation.int.ts`, `escalation-api.int.ts` | Module 9: escalation lifecycle (queue, accept, assign, resolve), one open escalation per conversation, customer kept with the team, SLA breach, email ticket escalation, hand-over brief, escalation APIs and role checks |
| `UI-AUTH-*` | Browser functional | `tests/ui/auth.spec.ts` | Login, sign-up, validation, access protection, and rate limits |
| `UI-SETUP-*` | Browser functional | `tests/ui/setup-wizard.spec.ts` | Initial inbox, agent, knowledge, and chatbot setup |
| `UI-TKT-*` | Browser functional | `tests/ui/tickets.spec.ts` | Ticket listing, search, filters, views, creation, bulk actions, and pagination |
| `UI-CHT-*` | Browser functional | `tests/ui/chats.spec.ts` | Conversation listing, search, filters, and thread viewing |
| `UI-AGT-*` | Browser functional | `tests/ui/agents.spec.ts` | Agent listing, search, views, creation, settings, deletion, and agent tabs |
| `UI-PRM-*` | Browser functional | `tests/ui/prompts.spec.ts` | Prompt templates, variables, search, validation, and deletion |
| `UI-KB-*` | Browser functional | `tests/ui/knowledge-base.spec.ts` | Knowledge sources, search, filters, ingestion, details, and deletion |
| `UI-ANL-*` | Browser functional | `tests/ui/analytics.spec.ts` | KPI cards, latency, interactions, date/channel filters, reports, and CSV export |
| `UI-BOT-*` | Browser functional | `tests/ui/chatbots.spec.ts` | Chatbot creation, configuration, saving, deletion, and embed actions |
| `UI-INB-*` / `UI-INT-*` | Browser functional | `tests/ui/inbox-integrations.spec.ts` | Inbox configuration and channel integrations |
| `UI-WID-*` | Browser functional | `tests/ui/widget.spec.ts` | Widget branding, grounded answers, email capture, controls, allowed domains, and live takeover |
| `UI-M2-*` | Browser functional | `tests/ui/agentic-tools.spec.ts` | Tool listing, tool test-runner, action logs, chain of thought, filters, and appointments |
| `UI-LED-*` | Browser functional | `tests/ui/leads.spec.ts` | Lead listing, filters, details, CSV export, and lead settings |
| `UT-68` | Unit | `tests/unit/groq-models.test.ts` | Groq's retired Llama models mapped to Qwen 3.8, reasoning switched off/low for fast answers, streamed Groq request settings, 200-token calls, background jobs on GPT-OSS 20B |
| `UI-VOI-02` | Browser, live (opt-in) | `tests/ui/voice-live.spec.ts` | A real call: recorded question as the microphone, real Deepgram and AI; reports the time from the end of speech to the first audio. Run: `node scripts/voice/make-test-question.mjs`, then `VOICE_LIVE_WAV=tests/ui/.auth/voice-question.wav npx playwright test tests/ui/voice-live.spec.ts` |
| `UI-VOI-01` | Browser functional | `tests/ui/voice.spec.ts` | A call in a real browser with Deepgram simulated and a generated microphone: the caller's words, the streamed real-AI answer spoken phrase by phrase without Markdown, the response time shown and reported, hanging up |
| `UI-STR-*` | Browser functional | `tests/ui/streaming.spec.ts` | The widget reply grows while it is written (real AI), then becomes the saved answer; the Playground shows "First word" and "Complete" times; Analytics shows the first-word median; the answer after a skipped lead form streams |
| `UI-P1-*` | Browser functional | `tests/ui/p1-fixes.spec.ts` | Priority-1 fixes: inbox auto-reply, automation help, security headers and cross-site refusal |
| `UI-BIL-*` | Browser functional | `tests/ui/billing.spec.ts` | Module 3: billing page, yearly prices, forged webhook refused |
| `UI-M11-*` | Browser functional | `tests/ui/integrations-admin.spec.ts` | Module 11: audit log tab, API key lifecycle, custom roles, connector checks, OpenAPI |
| `UI-ESC-*` | Browser functional | `tests/ui/escalations.spec.ts` | Module 9: a visitor asking for a person is escalated to the queue, accept and hand back, escalation settings, CSV export |
| `API-01`–`API-08` | HTTP E2E | `scripts/e2e/e2e-all.mjs` | Authentication, assistant setup, knowledge base, tickets, widget sessions, leads, analytics, and dashboard pages |
| `API-09` | HTTP E2E | `scripts/e2e/e2e-m2.mjs` | Module 2 agentic tools, confirmations, appointments, and action logs with a real model |

Each test inside a group has its own ID, for example `UT-01.08` or
`IT-02.08`; see "Running a test by its ID or name" below.

The browser `UI-*` tests are the project’s functional tests. The `UT-*`,
`IT-*`, and `API-*` suites provide lower-level, cross-module, and HTTP workflow
coverage for the same requirements. A requirement can appear in more than one
layer because each layer verifies a different boundary.

## 5. Unit tests

Unit tests normally do not need a running server. Run all unit tests once:

```powershell
npm test
```

Run unit tests in watch mode while developing:

```powershell
npm run test:watch
```

Run one test file:

```powershell
npx vitest run tests/unit/example.test.ts
```

Run multiple files:

```powershell
npx vitest run `
  tests/unit/example.test.ts `
  tests/unit/another.test.ts
```

Run tests matching a name or phrase:

```powershell
npx vitest run -t "validation"
```

### Running a test by its ID or name

Every test has an ID at the start of its name:

| Kind | Group ID | Test ID | Example name in the code |
|---|---|---|---|
| Unit (Vitest) | `UT-01` | `UT-01.08` | `UT-01.08 rejects short passwords` |
| Integration (Vitest) | `IT-02` | `IT-02.08` | `IT-02.08 'no' cancels a pending action` |
| Browser (Playwright) | - | `UI-TKT-02` | `UI-TKT-02 an agent creates a ticket and finds it by search - FR-5.5, FR-5.2` |

The number after the dot always has two digits, so `UT-01.01` never also
selects `UT-01.10`. Run one test, or a whole group, with its ID:

```powershell
npx vitest run -t "UT-01.08"
npx vitest run -t "UT-01"
npm run test:integration -- -t "IT-02.08"
npm run test:integration -- -t "IT-02"
npx playwright test -g "UI-TKT-02"
```

`-t` (Vitest) and `-g` (Playwright) treat the text as a pattern and run every
test whose full name contains it. No test name contains brackets or other
pattern characters, so a full name copied from the code or from the final
report also works, for example
`npx vitest run -t "UT-01.08 rejects short passwords"`.

The final report (Chapter 5 and Appendix C) uses the same IDs and names as the
code. `npx vitest list` prints them all.

The business-rule tests (decision tables, report section 5.3 and Appendix C)
are in `tests/unit/business-rules.test.ts` (UT-46 BR-4 allowed widget domains,
UT-47 BR-7 lead form) and `tests/integration/business-rules.int.ts` (IT-14 BR-1
when the AI answers in the widget, IT-15 BR-2 account registration, IT-16 BR-3
inbox email address, IT-17 BR-5 confidence threshold). Each test is one column
R1, R2, ... of its decision table, for example
`npm run test:integration -- -t "IT-14.06"` runs "R6 in Operator offline mode
the AI waits when a team member is online".

Running by file and line also always works:

```powershell
npx vitest run tests/unit/auth-and-rbac.test.ts:56
npx playwright test tests/ui/tickets.spec.ts:15
```

The Test ID and Test Script columns of the final report's tables (Chapter 5)
are the IDs and exact names from the code, so either can be pasted after `-t`.

When passing Vitest arguments through the `npm test` script, include `--`
before the Vitest options. Without it, npm may treat the filter as a script
argument instead of forwarding it to Vitest:

```powershell
npm run test -- -t "UT-07"
```

The `UT-07 agent behaviour settings` tests are defined in
`tests/unit/agent-and-integration-config.test.ts`. The command above runs the
nine tests in that group while skipping unrelated tests. You can also invoke
Vitest directly:

```powershell
npx vitest run -t "UT-07"
```

To run a single test, use its ID (or its complete name from the test file or
from `npx vitest list`), for example three of the UT-07 tests:

```powershell
npm run test -- -t "UT-07.03" --reporter=verbose
npm run test -- -t "UT-07.06" --reporter=verbose
npm run test -- -t "UT-07.07" --reporter=verbose
```

The configured input data is the literal value passed to each function in
`tests/unit/agent-and-integration-config.test.ts`, such as `"SHOUTY"`, `5`,
or `"google/gemini-2.5-flash"`. The expected result is the value supplied to
`expect(...).toBe(...)`, `expect(...).toContain(...)`, or
`expect(...).toMatch(...)`. Vitest reports pass/fail for these assertions, but
it does not print passing values by default. To inspect a value, assign it to
a variable and temporarily log it:

```ts
const tone = normalizeAgentTone("SHOUTY");
console.log({ input: "SHOUTY", output: tone });
expect(tone).toBe("FRIENDLY");
```

Run the filtered test with `--reporter=verbose` to see the test name and the
logged input/output. Remove temporary logging after checking the result.

Run a file interactively in watch mode:

```powershell
npx vitest tests/unit/example.test.ts
```

Run with coverage if coverage is configured:

```powershell
npx vitest run --coverage
```

For this project, unit tests are in `tests/unit/`.

## 6. Integration tests

Integration tests use several application components and usually require a
throwaway database with migrations applied.

Run all integration tests:

```powershell
npm run test:integration
```

Run one integration file:

```powershell
npx vitest run `
  --config vitest.integration.config.mts `
  tests/integration/example.int.ts
```

Run one integration test by its ID (or its name):

```powershell
npm run test:integration -- -t "IT-11.03"
npm run test:integration -- -t "IT-11.03 filters and sorts runs - UI-4"
```

Integration tests need `TEST_DATABASE_URL` set to a throwaway database with
the migrations applied (see section 1); configure it in the same PowerShell
window before running the command. Never use a production
database.

For this project, integration tests are in `tests/integration/`.

## 7. Playwright browser tests

Playwright tests verify user flows through a real browser. They normally
require:

- A running development server
- A test account
- Seeded test data
- A supported browser
- The correct test URL

Run all Playwright tests:

```powershell
npm run test:ui
```

Run with the browser visible:

```powershell
npx playwright test --headed
```

Run in debugging mode:

```powershell
npx playwright test --debug
```

Install browsers if required:

The tests use the Google Chrome already installed on the computer
(`channel: "chrome"` in `playwright.config.ts`). Install Google Chrome, or let
Playwright install it:

```powershell
npx playwright install chrome
```

Run one test file:

```powershell
npx playwright test tests/ui/example.spec.ts
```

Run one test by its ID or title:

```powershell
npx playwright test -g "UI-TKT-02"
```

Run tests matching a feature:

```powershell
npx playwright test -g "login"
```

Use a different local application URL:

```powershell
$env:E2E_BASE_URL = "http://localhost:3000"
npm run test:ui
```

Run with a specific reporter:

```powershell
npx playwright test --reporter=list
npx playwright test --reporter=line
npx playwright test --reporter=html
```

Open the HTML report:

```powershell
npx playwright show-report
```

The project stores UI JSON results in `test-results/ui-results.json`.
Screenshots and traces may be retained for failed tests. Open a trace with:

```powershell
npx playwright show-trace path\to\trace.zip
```

### After the sample-data seed succeeds

When `node scripts/e2e/seed-demo.mjs` completes successfully, continue with
the browser tests from the same project folder:

```powershell
npm run test:ui
```

If Playwright reports that Chrome or another browser is missing, install the

The tests use the Google Chrome already installed on the computer
(`channel: "chrome"` in `playwright.config.ts`). Install Google Chrome, or let
Playwright install it:

```powershell
npx playwright install chrome
```

Open the HTML report after the test run:

```powershell
npx playwright show-report
```

Then run the remaining validation layers:

```powershell
npm test
npm run test:integration
npm run lint
npm run build
```

Record the following in the test report:

- Passed tests
- Failed tests
- Skipped or blocked tests
- Related SRS requirement IDs
- Screenshots, traces, or downloaded files used as evidence

Playwright JSON results are stored in `test-results\ui-results.json`, and the
HTML report is stored in the `playwright-report\` folder.

## 8. HTTP end-to-end tests

HTTP end-to-end scripts test the running application without controlling the
browser. They are useful for authentication, API behavior, workflows, data
permissions, and cross-module checks.

Run the complete suite:

```powershell
node scripts/e2e/e2e-all.mjs
```

Skip checks that require an AI provider:

```powershell
node scripts/e2e/e2e-all.mjs --skip-ai
```

Run a module-specific suite when available:

```powershell
. .\scripts\tests-env.ps1
node scripts/e2e/setup-m2.mjs
node scripts/e2e/e2e-m2.mjs
```

`setup-m2.mjs` is a preparation step for Module 2. It logs into the running
application, adds the demo agent's `Track order` tool from its template, enables
the agent tools, binds the available tools, and adds the
`where is my order` / `track my order` intent rule. Run it after
`seed-demo.mjs` and before Module 2 HTTP or UI tests. It changes the configured
local test database and is not itself a test.

The scripts should print `PASS` or `FAIL` and return a non-zero exit code when
one or more checks fail. A skipped AI check must not be reported as a pass.

## 9. Find test names and inspect test code

### List Playwright test names

List all Playwright tests without running them:

```powershell
npx playwright test --list
```

List tests from one file:

```powershell
npx playwright test tests/ui/tickets.spec.ts --list
```

List tests matching a feature or test ID:

```powershell
npx playwright test -g "ticket" --list
npx playwright test -g "UI-TKT-01" --list
```

### List Vitest test names

List unit tests without running them:

```powershell
npx vitest list
```

List tests from one file:

```powershell
npx vitest list tests/unit/auth-and-rbac.test.ts
```

List integration tests:

```powershell
npx vitest list --config vitest.integration.config.mts
```

Run Vitest with detailed test names:

```powershell
npx vitest run --reporter=verbose
```

### Find test files and source code

The project test folders are:

- Unit tests: `tests/unit/`
- Integration tests: `tests/integration/`
- Playwright tests: `tests/ui/`

Open a test file from Command Prompt or PowerShell:

```powershell
code tests/ui/tickets.spec.ts
```

Search test declarations from PowerShell:

```powershell
Select-String -Path "tests\**\*.ts" -Pattern 'test\(|it\(|describe\('
```

The Playwright test title contains the test ID, a description and the related
SRS requirements. For example:

```ts
test("UI-TKT-01 tickets are listed - FR-5.1", async ({ page }) => {
  // Test actions and assertions
});
```

In this example:

- `UI-TKT-01` is the unique test ID.
- `FR-5.1` is the linked SRS requirement.
- `tickets are listed` describes the behavior under test.

### Run and debug one test

Run one Playwright test:

```powershell
npx playwright test -g "UI-TKT-01"
```

Run it with the browser visible:

```powershell
npx playwright test -g "UI-TKT-01" --headed
```

Run it in debug mode:

```powershell
npx playwright test -g "UI-TKT-01" --debug
```

Run one unit test by name:

```powershell
npx vitest run -t "validation"
```

### Understand test assertions

Test actions describe what the user or system does. Assertions describe what
must be true for the test to pass. Look for statements such as:

```ts
await expect(page.getByText("Tickets")).toBeVisible();
await expect(page).toHaveURL(/tickets/);
await expect(locator).toHaveText("Expected text");
await expect(locator).toBeEnabled();
await expect(locator).toHaveValue("Expected value");
```

For example:

```ts
await page.getByRole("button", { name: "Create ticket" }).click();
await page.getByLabel("Subject").fill("Test ticket");
await page.getByRole("button", { name: "Save" }).click();

await expect(page.getByText("Test ticket")).toBeVisible();
```

The first statements perform the user actions. The final statement verifies
the expected result.

### Review one test against the SRS

For each test case:

1. Copy the test ID and linked SRS ID.
2. Read the complete test title.
3. Read the setup and navigation steps.
4. Identify each user action.
5. Identify every `expect(...)` assertion.
6. Compare the assertions with the SRS expected result.
7. Run the test individually.
8. Perform the same flow manually.
9. Record the result and evidence in the traceability matrix.

The UI test-to-SRS mapping is also documented in `tests/ui/README.md`.

## 10. Lint and build checks

Run linting:

```powershell
npm run lint
```

Build the application:

```powershell
npm run build
```

Run the production build after a successful build:

```powershell
npm run start
```

Lint and build results do not replace functional tests. They only confirm
static quality and compilation.

## 11. Test one feature at a time

For each feature, use this sequence:

1. Read the feature requirement in the SRS.
2. Identify the related unit, integration, UI, or end-to-end test.
3. Prepare the required test data and permissions.
4. Run the smallest automated test that covers the feature.
5. Perform the same flow manually in the application.
6. Check the normal flow, invalid input, permissions, errors, and persistence.
7. Capture evidence.
8. Record the result before moving to the next feature.

Example command sequence:

```powershell
npx vitest run tests/unit/feature.test.ts
npx vitest run --config vitest.integration.config.mts tests/integration/feature.int.ts
npx playwright test tests/ui/feature.spec.ts
```

## 12. Manual testing procedure

For every SRS requirement:

1. Copy the requirement ID and expected behavior from the SRS.
2. Write down the preconditions.
3. List the exact steps a tester must perform.
4. Execute the steps in a clean test account or workspace.
5. Compare the actual result with the expected result.
6. Refresh or revisit the page to verify persistence where relevant.
7. Test required-field validation and invalid input.
8. Test role-based access if the requirement involves permissions.
9. Capture screenshots, downloaded files, or logs.
10. Mark the requirement as Pass, Fail, or Blocked.

A green automated test is evidence only for the behavior that it actually
checks. It does not prove that every part of a broader requirement works.

## 13. SRS traceability

Each test should have a unique test ID and reference one or more SRS
requirements. If the test title contains the requirement ID, the result can be
traced directly from the test report to the SRS.

Use this matrix:

| Test ID | SRS ID | Requirement | Test type | Preconditions | Steps | Expected result | Actual result | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|
| TEST-001 | FR-1.1 | User can sign in | UI | Test account exists | Enter valid credentials | Dashboard opens |  | Screenshot/report | Pass/Fail |

Use one row for each test case. If one test covers multiple requirements, list
all of them or create separate traceability rows.

### Status definitions

- **Pass:** The automated and/or manual result matches the SRS.
- **Fail:** The application result does not match the expected behavior.
- **Blocked:** The test could not run because of an environment, data, or
  dependency problem.
- **Skipped:** The test was intentionally not run; it is not a pass.
- **Not tested:** No test has been performed yet.

## 14. Test evidence

Useful evidence includes:

- Screenshot of the completed flow
- Screenshot of validation or error feedback
- Downloaded CSV, PDF, or other generated file
- Playwright HTML report
- Playwright JSON result
- Playwright trace for a failure
- Console or server log, when relevant
- Database record confirmation, when appropriate and safe

Use clear filenames:

```text
TEST-001-login-success.png
TEST-002-required-field-validation.png
TEST-003-export-download.csv
```

Do not include passwords, API keys, session cookies, tokens, or private
database connection strings in evidence.

## 15. Failure investigation

When a test fails:

1. Save the complete failure message.
2. Record the test ID and SRS ID.
3. Re-run only the failing test.
4. Check whether the failure is reproducible.
5. Review screenshots, traces, logs, and network responses.
6. Decide whether the cause is an application defect, test defect, missing
   data, unavailable service, or environment problem.
7. Record the cause and retest after a fix.

A failed setup step should be reported as **Blocked**, not as a functional
failure, unless the setup itself is part of the requirement.

## 16. Common troubleshooting

### Dependencies are missing

```powershell
npm ci
```

### Database or migrations are missing

```powershell
npx prisma generate
npx prisma migrate deploy
```

### Browser tests cannot connect

Confirm that:

- The development server is running.
- The test URL is correct.
- The test account exists.
- The required seed data exists.
- The configured port is not being used by another application.

### Playwright browsers are missing

The tests use the Google Chrome already installed on the computer
(`channel: "chrome"` in `playwright.config.ts`). Install Google Chrome, or let
Playwright install it:

```powershell
npx playwright install chrome
```

### Expected demo records are missing

Run the project’s seed command against a throwaway database:

```powershell
node scripts/e2e/seed-demo.mjs
```

If the command reports:

```text
Missing TEST_DATABASE_URL. See scripts/e2e/README.md.
```

load the local test environment in the same PowerShell window first:

```powershell
. .\scripts\tests-env.ps1
node scripts/e2e/seed-demo.mjs
```

The development server should already be running, and `TEST_DATABASE_URL`
should refer to the same database as `DATABASE_URL` used by that server.

### AI-dependent tests fail

Confirm that a development AI provider is configured. To verify all
non-AI checks separately:

```powershell
node scripts/e2e/e2e-all.mjs --skip-ai
```

Do not report skipped AI checks as passed.

### A clean local database is required

The following commands delete the Docker database volume and its data:

```powershell
docker compose down -v
docker compose up -d
npx prisma migrate deploy
```

Use this only when a full local reset is intentional.

## 17. Recommended complete test order

Run the checks in this order:

```powershell
npm test
npm run test:integration
npm run test:ui
node scripts/e2e/e2e-all.mjs
npm run lint
npm run build
```

If AI services are unavailable, run the non-AI end-to-end checks separately
and clearly record the skipped tests.

## 18. Final test report

Before declaring the system verified, record:

- Date and environment
- Database used
- Test account or role used
- Unit test result
- Integration test result
- UI/E2E result
- HTTP E2E result
- Lint result
- Build result
- Passed, failed, blocked, and skipped test counts
- SRS requirements covered
- Evidence locations
- Known limitations

Use this summary:

```text
Environment: development / staging
Date:

Unit tests: PASS / FAIL / BLOCKED
Integration tests: PASS / FAIL / BLOCKED
UI/E2E tests: PASS / FAIL / BLOCKED
HTTP E2E tests: PASS / FAIL / BLOCKED
Lint: PASS / FAIL
Build: PASS / FAIL

SRS requirements passed:
SRS requirements failed:
SRS requirements blocked:
SRS requirements skipped:

Known limitations:
Evidence location:
```
