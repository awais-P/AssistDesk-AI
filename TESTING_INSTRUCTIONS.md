# Testing Guide

This guide provides a general process for testing the application from setup
through final reporting. It covers automated tests, manual testing, SRS
traceability, test evidence, and common troubleshooting steps.

Use a development or throwaway environment. Never run tests that create,
modify, or delete data against production.

## 1. Prepare the environment

Open PowerShell in the project folder:

```powershell
cd "C:\Users\Ahmed Mujtaba\coding projects\AssistDesk-AI"
```

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

## 9. Lint and build checks

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

## 10. Test one feature at a time

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

## 11. Manual testing procedure

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

## 12. SRS traceability

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

## 13. Test evidence

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

## 14. Failure investigation

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

## 15. Common troubleshooting

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

## 16. Recommended complete test order

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

## 17. Final test report

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
