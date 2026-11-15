# Template for the local test environment loader.
#
# Copy this file to scripts/tests-env.ps1 (git-ignored), fill in your own local
# values, then load it into the current PowerShell window before running the
# integration, UI or end-to-end tests:
#
#   Copy-Item scripts/tests-env.example.ps1 scripts/tests-env.ps1
#   . .\scripts\tests-env.ps1
#
# Use a local development or throwaway database only, never production.

# Database used by the tests (docker-compose.yml publishes PostgreSQL on port 5433).
$env:TEST_DATABASE_URL = "postgresql://<user>:<password>@localhost:5433/<database>?schema=public"
# Prisma commands (npx prisma migrate deploy) use DATABASE_URL; point it at the same database.
$env:DATABASE_URL = $env:TEST_DATABASE_URL

# Must match the values the development server runs with.
$env:ASSISTDESK_DEMO_PASSWORD = "<demo admin password>"
$env:CRON_SECRET = "<cron secret>"

# The running development server used by the UI and end-to-end tests.
$env:E2E_BASE_URL = "http://localhost:3000"

# Let tools and webhooks call the local sample store and test receivers.
$env:ASSISTDESK_ALLOW_PRIVATE_TOOLS = "true"
$env:ASSISTDESK_ALLOW_PRIVATE_WEBHOOKS = "true"

Write-Host "Test environment loaded for this PowerShell window."
