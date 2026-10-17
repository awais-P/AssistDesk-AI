# Browser UI tests (Playwright)

System-level tests that drive a **running** AssistDesk server in Chrome, the way a user would. Each test title starts with a test case ID (for example `UI-TKT-02`) and the SRS requirements it checks (for example `[FR-5.5, FR-5.2]`), so a result can be traced back to its requirement.

| File | IDs | Covers |
|---|---|---|
| `auth.spec.ts` | UI-AUTH-01…07 | FR-1 login, sign-up, validation, sign-up limit, redirects |
| `setup-wizard.spec.ts` | UI-SETUP-01…02 | FR-2, FR-3, FR-4 onboarding wizard |
| `tickets.spec.ts` | UI-TKT-01…08 | FR-5 tickets list, create, search, filters, views, bulk, menu, pagination |
| `chats.spec.ts` | UI-CHT-01…03 | FR-6 conversation list, thread, search, filters |
| `agents.spec.ts` | UI-AGT-01…06 | FR-7, FR-8 agents and agent settings |
| `prompts.spec.ts` | UI-PRM-01…03 | FR-9 prompt templates and variables |
| `knowledge-base.spec.ts` | UI-KB-01…05 | FR-10 knowledge sources, ingestion, filters |
| `analytics.spec.ts` | UI-ANL-01…06 | FR-11 KPIs, latency chart, interactions, reports, export |
| `chatbots.spec.ts` | UI-BOT-01…05 | FR-12, FR-13, FR-14 chatbots and their configuration |
| `inbox-integrations.spec.ts` | UI-INB-01…03, UI-INT-01…02 | FR-15 inbox configuration, FR-16 integrations |
| `widget.spec.ts` | UI-WID-01…06 | FR-17 website widget, grounded answers, live takeover |
| `agentic-tools.spec.ts` | UI-M2-01…05 | Module 2 tools, test runner, action logs, appointments |
| `leads.spec.ts` | UI-LED-01…04 | Module 8 leads, detail, CSV, settings |

## Running

1. Start the app against a **throwaway** database with the demo data seeded (same settings as `scripts/e2e/README.md`: `ASSISTDESK_SEED_DEMO=true`, `ASSISTDESK_DEMO_PASSWORD`, `ASSISTDESK_ALLOW_PRIVATE_TOOLS=true`). The tests create and delete their own agents, chatbots, prompts, tickets and accounts.
2. Fill the demo workspace once with the sample store: `node scripts/e2e/seed-demo.mjs` (same environment variables as the end-to-end scripts; it uses the real AI for the sample chats). The read-only checks look for these records (Ali Raza, Hina Shah, Usman Tariq, the store-policy source…).
3. Run:

   ```bash
   E2E_BASE_URL=http://localhost:3000 ASSISTDESK_DEMO_PASSWORD=… npm run test:ui
   ```

   Chrome must be installed (the tests use `channel: "chrome"`; no browser download is needed). Results are written to `test-results/ui-results.json` and an HTML report to `playwright-report/`.

Notes:

- One worker, in order: the tests share the demo workspace, and dev mode compiles each route the first time it is opened.
- Sign-up is limited per network, so tests that create accounts send a documentation-range address (`198.51.100.x`) in `X-Forwarded-For`.
- `UI-WID-02` needs a working AI model or the knowledge-base fallback; both answer the warranty question from the store-policy source.
