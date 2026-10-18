# Testing Guide

This guide provides a general process for testing the application from setup
through final reporting. It covers automated tests, manual testing, SRS
traceability, test evidence, and common troubleshooting steps.

Use a development or throwaway environment. Never run tests that create,
modify, or delete data against production.

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

The application and standalone end-to-end scripts may use different variable
names. The development server uses `DATABASE_URL`, while the scripts in
`scripts/e2e/` require `TEST_DATABASE_URL`. Both variables must point to the
same throwaway PostgreSQL database.

The seed and HTTP end-to-end scripts also require:

```text
TEST_DATABASE_URL
ASSISTDESK_DEMO_PASSWORD
CRON_SECRET
```

Values written in `.env` are loaded by the application, but they are not
automatically available to every standalone `node` command. On Windows,
export the values in the PowerShell session before running a script:

```powershell
$env:TEST_DATABASE_URL = "<same throwaway database URL used by the app>"
$env:ASSISTDESK_DEMO_PASSWORD = "<same development password used by the app>"
$env:CRON_SECRET = "<same development cron secret used by the app>"
$env:E2E_BASE_URL = "http://localhost:3000"
$env:ASSISTDESK_ALLOW_PRIVATE_TOOLS = "true"
$env:ASSISTDESK_ALLOW_PRIVATE_WEBHOOKS = "true"
```

For example, a PostgreSQL connection string has this general format:

```text
postgresql://username:password@localhost:5432/assistdesk_test
```

Do not use a production database. If `DATABASE_URL` is already available as a
PowerShell environment variable, it can be copied for the script:

```powershell
$env:TEST_DATABASE_URL = $env:DATABASE_URL
```

## 2. Prepare test data

Use separate data for testing. Before starting:

1. Confirm that the database is running.
2. Confirm that the required environment variables are configured.
3. Apply database migrations.
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

When passing Vitest arguments through the `npm test` script, include `--`
before the Vitest options. Without it, npm may treat the filter as a script
argument instead of forwarding it to Vitest:

```powershell
npm run test -- -t "UT-07"
```

The `UT-07 agent behaviour settings` tests are defined in
`tests/unit/agent-and-integration-config.test.ts`. The command above runs the
three tests in that group while skipping unrelated tests. You can also invoke
Vitest directly:

```powershell
npx vitest run -t "UT-07"
```

To run the three UT-07 tests one at a time, use the complete test title:

```powershell
npm run test -- -t "defaults response length to balanced" --reporter=verbose
npm run test -- -t "uses the fallback for invalid numeric settings" --reporter=verbose
npm run test -- -t "starts model fallback with the chosen model" --reporter=verbose
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

Run one integration test by name:

```powershell
npx vitest run `
  --config vitest.integration.config.mts `
  -t "creates a record"
```

If an integration test needs a database variable, configure it in the
development environment before running the command. Never use a production
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

```powershell
npx playwright install
```

Run one test file:

```powershell
npx playwright test tests/ui/example.spec.ts
```

Run one test by its ID or title:

```powershell
npx playwright test -g "TEST-ID"
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
required browser binaries:

```powershell
npx playwright install
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
node scripts/e2e/setup-m2.mjs
node scripts/e2e/e2e-m2.mjs
```

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

The Playwright test title normally contains the test ID, the related SRS
requirement, and a description. For example:

```ts
test("UI-TKT-01 [FR-5.1] tickets are listed", async ({ page }) => {
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

```powershell
npx playwright install
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

set the required variables in the same PowerShell window first:

```powershell
$env:TEST_DATABASE_URL = "<throwaway PostgreSQL URL>"
$env:ASSISTDESK_DEMO_PASSWORD = "<development demo password>"
$env:CRON_SECRET = "<development cron secret>"
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
