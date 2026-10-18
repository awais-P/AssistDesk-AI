# End-to-end scripts

These drive the **running app over HTTP** (real API routes, real database, real AI model) and check every module. They complement the automated suites:

| Suite | Command | Needs |
|---|---|---|
| Unit | `npm test` | nothing |
| Integration | `. .\scripts\tests-env.ps1; npm run test:integration` | local or throwaway PostgreSQL database with migrations applied |
| **End-to-end** | `node scripts/e2e/e2e-all.mjs` | a running dev server + its database (below) |

Results of the 10 Oct 2026 verification are in [VERIFICATION_REPORT.md](../../VERIFICATION_REPORT.md).

## Setup

1. Use a **local development or throwaway** PostgreSQL database (the scripts create workspaces, tickets, leads and so on). Load the test environment with `. .\scripts\tests-env.ps1`, then apply migrations with `npx prisma migrate deploy`.
2. Start the dev server against it with these settings (in `.env` or the shell):

   ```
   DATABASE_URL=<the throwaway database>
   ASSISTDESK_SEED_DEMO=true              # seeds admin@assistdesk.local, the demo chatbot and email integration
   ASSISTDESK_DEMO_PASSWORD=<choose one>
   CRON_SECRET=<choose one>
   ASSISTDESK_ALLOW_PRIVATE_WEBHOOKS=true # the script's webhook receiver listens on 127.0.0.1:4555
   ASSISTDESK_ALLOW_PRIVATE_TOOLS=true    # tools may call the local sample store
   ASSISTDESK_DEFAULT_GROQ_API_KEY=…      # or another managed AI key; needed for the chat checks
   ```

   then `npm run dev`. Open the app once so the demo data is seeded.
3. Run the scripts after loading the environment:

   ```powershell
   . .\scripts\tests-env.ps1
   node scripts/e2e/e2e-all.mjs            # all modules, ~130 checks, ~3 min
   node scripts/e2e/e2e-all.mjs --skip-ai  # without AI calls
   node scripts/e2e/setup-m2.mjs           # configure Module 2 demo tools
   node scripts/e2e/e2e-m2.mjs             # Module 2 with a real model
   ```

`setup-m2.mjs` is a preparation script, not a test. It logs into the running
application, adds the demo agent's `Track order` tool from its template if
needed, enables and binds the available tools, and adds the
`where is my order` / `track my order` intent rule. Run it after
`seed-demo.mjs` and before `e2e-m2.mjs` or the Module 2 Playwright tests.

Each check prints `PASS`/`FAIL`; the exit code is non-zero if anything failed. `e2e-all.mjs` also writes `e2e-all.results.json` next to itself (git-ignored).

## What `e2e-all.mjs` covers

- **Accounts and roles:** sign-up, weak-password rule, duplicates, hashing, password change, invites with a temporary password, Agent-role 403s, anonymous 401s.
- **M1:** agent and chatbot creation; embed token for allowed and refused sites; widget API token check; inbox, prompts, canned replies, tags.
- **M10:** a text source is chunked and embedded; retrieval finds it; SSRF block on URL sources.
- **M7:** ticket lifecycle; internal notes; bulk actions; inbound email; threading by `[PREFIX-NUMBER]`; webhook secret.
- **M5:** widget chat answered from the knowledge base; hashed tokens; history; SSE stream; takeover and hand-back; agent reply; transcript; end chat and linked new session; contact memory; workspace isolation; 429 rate limit; cron secret.
- **M8:** lead form pauses the AI; validation; capture with score; list, status, note and CSV; webhooks verified with HMAC-SHA256, plus tamper detection.
- **M4:** dashboard, live, reports, improvements, export and its role check, feedback.
- **UI:** all 27 dashboard pages render for a signed-in admin; anonymous users are redirected.

## Notes

- The free OpenRouter tier allows about 50 model requests per day. Running the AI checks several times in one day can exhaust it, and replies then come from the knowledge-base fallback. Use a Groq key for repeated runs.
- In dev mode, a route is compiled on its first request (up to ~12 s); the SSE check allows for that.
- Booking hours in the demo workspace are Mon–Fri; `e2e-m2.mjs` asks for the next weekday.
