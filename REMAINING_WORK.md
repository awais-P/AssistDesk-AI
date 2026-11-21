# AssistDesk: Remaining Work

> **Updated:** 21 Nov 2026 · **Overall progress:** ≈ 87% (equal weight of the 11 modules)
> This file lists **only what is still open**. Everything finished is in [CHANGELOG.md](CHANGELOG.md) (newest first) and the evidence is in [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md).

---

## 0. Before you start (new team member)

- **Run the app:** follow the setup README (`.env.example`, `docker-compose.yml`), then `npx prisma migrate deploy` and `npm run dev`. Production runs on Railway from the `main` branch; see [DEPLOYMENT.md](DEPLOYMENT.md).
- **Where things are:**
  - pages in `app/`, API routes in `app/api/`;
  - business logic in `src/lib/` (one file per area, e.g. `escalation.ts`, `leads.ts`, `refunds.ts`);
  - UI components in `src/components/`;
  - database schema in `prisma/schema.prisma`.
- **Module docs:** `M2_…` to `M11_…` in the repo root explain each module, its design and its known limits.
- **Tests** (see [TESTING_INSTRUCTIONS.md](TESTING_INSTRUCTIONS.md)):
  - unit: `npm test`;
  - integration (needs a throwaway database): `npm run test:integration`;
  - browser: `npm run demo`, then `npm run test:ui`.
- **Test IDs:** the next free IDs are **UT-74** (unit) and **IT-36** (integration). Put the ID in the test name and list it in `tests/ui/README.md`.
- **Git:**
  - work on your own branch and push only when asked;
  - `main` gets one squashed commit without the project docs.
- **When you finish an item:**
  - delete it from this file;
  - add a dated entry to `CHANGELOG.md`;
  - update the module's status row in `VERIFICATION_REPORT.md`.
- **Effort:** **S** is under half a day, **M** is 1–2 days, **L** is 3 or more days. ⚠️ means it needs an outside account or key that only the team can create.

---

## 1. Status at a glance

| Module | Done | Biggest thing missing |
|---|---|---|
| M1 Assistant creation & omnichannel | ≈ 84% | Slack sign-in with OAuth; WhatsApp images and files |
| M2 Agentic tools | ≈ 94% | Shopify actions run only against a fake Shopify |
| M3 Subscription & payment | ≈ 82% | One run with live Stripe test keys; tax |
| M4 Monitoring & analytics | ≈ 84% | KPI cards don't refresh; speed never measured on big data |
| M5 Real-time context & sessions | ≈ 88% | Live updates only work on one server |
| M6 LLM management & fast inference | ≈ 80% | Voice answers take 1.1–2.8 s; the target is under 0.5 s |
| M7 User dashboard | ≈ 92% | Unsaved-changes prompt; small UI bugs |
| M8 Lead generation | ≈ 90% | Validation while typing; small filter gaps |
| M9 Support escalation | ≈ 93% | Skill-based routing (optional) |
| M10 Knowledge base | ≈ 86% | Pinecone and Firecrawl not switched on; files on the server disk |
| M11 Integrations & customization | ≈ 82% | Live HubSpot/Shopify run; more connectors; API write endpoints |

---

## 2. Start here: priorities in order

1. **Final report and slide deck** *(in progress, L)*. The build scripts are in `testenv/report` and the test results in `testenv/testing`.
   - Done:
     - unit and integration results re-run on 21 Nov (384/384; 204 passed, 1 skipped);
     - the October results kept in `testing/results-60`.
   - Left:
     1. Run the full browser suite (`npm run test:ui`; it needs about 3 GB of free memory) and copy `test-results/ui-results.json` to `testing/results/ui.json`.
     2. Run `node scripts/e2e/e2e-all.mjs` and copy its results.
     3. Run `python testing/collect_results.py`.
     4. Draw the new diagrams in `report/diagrams`:
        - updated conceptual and layered diagrams;
        - a class diagram of the entities added after 60%;
        - sequence diagrams for Stripe checkout, streamed replies and voice, escalation with routing and alerts, and the public API with connectors.
     5. Take screenshots of the new screens: Escalations, Billing, Refunds, Connectors, Roles, Audit log, API keys, the voice call and the invoice page.
     6. Copy `build_report.py` to a final version with Chapters 3–5 rewritten for the final system:
        - 45 data models;
        - Railway deployment;
        - the APIs now used: Stripe, Deepgram, Brevo, Shopify, HubSpot, Cloudinary, WhatsApp, Slack.
     7. Rebuild the deck.
2. **Production build check** *(S)*: run `next build` once on a machine with enough memory and fix anything it reports.
3. **Demo script for the final evaluation** *(S)*. Walk through:
   - chat and the AI action with confirmation;
   - a voice call;
   - escalation with round-robin assignment;
   - a refund request approved on the Refunds page;
   - a lead and its webhook;
   - billing, an API key and a connector;
   - analytics.
4. **Security fixes** *(S–M)*: see §5.1. Do SEC-21, SEC-17 and SEC-32 first (small), then the shared DNS-rebinding fix (SEC-28/33/34).
5. **Rotate the keys that were pasted into chat** *(S)*: the Groq key, the Deepgram key, the WhatsApp token and the Meta App Secret. Create new ones, update `.env` and Railway, and delete the old ones.
6. **Documentation fixes** *(S)*: see §5.4.
7. **Live third-party runs** ⚠️ *(S each, once the accounts exist)*: see §3. Each one only needs to run once, with the result written into the module doc.
8. The module lists in §4, as time allows.

---

## 3. Needs an account or key from the team ⚠️

| Service | What it unlocks | Free option | Status |
|---|---|---|---|
| Pinecone | Vector database for the knowledge base (M10 FE-1) | Free tier | Coded, not configured (vectors are stored in Postgres meanwhile) |
| Firecrawl | Better website crawling (M10 FR-10.3) | Free tier | Coded, not configured (the built-in crawler is used meanwhile) |
| Stripe | One recorded checkout run (M3, OPS-18) | Test mode keys and the Stripe CLI | Tested against a fake Stripe only |
| Shopify | Order status, refunds and invoices on a real store (M2, M11) | Partner development store; the app needs `read_orders` and `write_orders` | Tested against a fake Shopify only; check that API version `2024-10` is still supported |
| HubSpot | Live lead sync (M11, OPS-17) | Developer test portal | Tested against a fake HubSpot only |
| Slack | A live channel run (M1) | Free Slack workspace | Not run against a real workspace |
| Google / Outlook calendar | Appointment calendar sync (M2) | Free developer accounts | Not built |

Already working in production: Groq, Deepgram, Brevo email, WhatsApp. Keys go in `.env` (local) or Railway variables only, never in the repository.

---

## 4. Open items by module

### M1: Assistant creation & omnichannel (≈ 84%)
- **FE-3 / FR-16.5 Slack OAuth** *(M)*: Slack connects with a pasted bot token; the SRS asks for "Add to Slack" with `oauth.v2.access`.
- **FE-3 WhatsApp media** *(M)*: only text and buttons are handled. Add images, documents and voice notes in both directions.
- **FR-3.6** *(S)*: the training step in the setup wizard can be skipped; the SRS says it is required.
- **FR-2/4** *(S)*: the inbox-prefix availability check runs on click. Make it live while typing (debounced).
- **FR-8.1** *(S)*: editing an agent opens a full page, not a side drawer. Build the drawer, or record the deviation in the module doc.
- **FR-14.8** *(S)*: the limit field can't be left empty for "unlimited" (range 1–1000).
- **FR-17.x widget** *(M)*:
  - the header dot follows the AI, not whether a person is online;
  - no read receipts;
  - AI and human message bubbles look the same.
- **Agent delete** *(S)*: it is a hard delete (audit-logged); the SDS describes a soft delete. Change it or document it.
- **BUG-19** *(S)*:
  - typing an agent name in the setup wizard overwrites a custom system prompt;
  - retrying a partly failed URL save re-submits the URLs already saved.
- **BUG-25** *(S)*: a message with only an attachment is answered using the file name as the question.
- **AI-07** *(S)*: the ticket "AI priority" is a regex, and a bare `down` matches "download". Use word boundaries.
- **UI-24** *(S)*: domain and URL chips in the setup wizard can't be removed.

### M2: Agentic tools (≈ 94%)
- **Confirm button in the widget** *(M, SEC-35)*: confirmation of data-changing actions relies on understanding the customer's "yes"/"no". Add real Confirm and Cancel buttons.
- **Appointment reminders and calendar sync** ⚠️ *(M)*: no reminder emails, and no Google/Outlook calendar.
- **Live Shopify run** ⚠️: see §3.

### M3: Subscription & payment (≈ 82%)
- **Live Stripe run** ⚠️ *(S once keys exist)*: record one end-to-end checkout in `M3_SUBSCRIPTION_PAYMENT.md` (OPS-18).
- **Tax and currencies** *(M)*: Stripe Tax/VAT and currencies other than USD.
- **Usage period** *(S)*: AI-reply usage is counted per calendar month. Count it per billing period.
- **Over-limit workspaces** *(S)*: workspaces already over a plan's limit are not cut back (limits only stop new items). Decide the rule and document it.
- **Billing browser test** *(S)*: give it its own workspace, so the shared demo workspace isn't limited.

### M4: Monitoring & analytics (≈ 84%)
- **FR-11.1** *(S)*: the KPI cards refresh only on page load. Poll them on an interval, like Live Sessions.
- **FR-11.2 / 11.3 / 11.5 and the latency definition** *(S–M)*: these are built differently from the SRS (explained in the M4 doc §8). Either align them, or keep the documented deviation and say so in the report.
- **PER-2, analytics under 2 s** *(M)*: never measured, and analytics add up raw rows (OPS-11). Measure once with a large workspace; add summary tables if it is slow.
- **UI-42** *(S)*:
  - the customer and ticket reports ignore the channel filter;
  - the lists on the Improve tab are capped.

### M5: Real-time context & sessions (≈ 88%)
- **PER-3 / OPS-09, scale beyond one server** *(M)*: live updates, visitor presence and team presence are kept in one server's memory. Use Postgres LISTEN/NOTIFY or Redis before running more than one Railway instance.
- **SEC-31** *(M)*: a typed email or phone links a visitor to an existing customer without verification (their memory is redacted). Add an email code (OTP) before linking.
- **SEC-32** *(S)*: any role can edit a customer's AI memory (the PATCH route has no role check).
- **FE-5** *(S)*: the EMAIL and VOICE expiry policies in `session-lifecycle.ts` are defined but not applied. Use them or remove them.
- **Unauthorised widget origin** *(S)*: a widget request from a domain that isn't allowed gets a 403 but isn't written to the audit log (`chatbot-widget.ts`, `widget/[widgetId]/page.tsx`).
- **UI-39** *(S)*: the Contacts list stops at 100 and fills with "Anonymous visitor". Add paging and a "hide anonymous" filter.

### M6: LLM management & fast inference (≈ 80%)
- **FE-6, voice answer under 500 ms** *(M)*: measured 1.1–2.8 s from the end of speech to the first audio on free tiers. Options:
  - paid Groq and Deepgram tiers;
  - a server region closer to the providers;
  - a smaller or faster model for voice;
  - start speaking at the first clause.

  Record the new measurement in the module doc.
- **FE-3, optional** *(M)*: use the 👍/👎 feedback automatically, e.g. prefer the better-rated model or flag weak answers for review.

### M7: User dashboard (≈ 92%)
- **FR-15.1** *(S)*: no "you have unsaved changes" prompt on any form (`beforeunload` and a route-leave guard).
- **FR-6.8** *(S)*: "System Bot" entries are shown inside the conversation thread; move them out or style them as events.
- **FR-5.4** *(S)*: no separate advanced-filter panel on Tickets.
- **Profile avatar** *(S)*: users can't upload their own avatar.
- **BUG-26** *(S)*:
  - agents see ticket Delete buttons (the server refuses the delete);
  - creating and renaming tags has no role check.
- **BUG-27** *(S)*: deleting every prompt template brings the 3 default ones back.
- **UI-32** *(S)*: Inboxes and Agents say "No … match the current search" when nothing exists yet.
- **UI-37** *(S)*: `workspace-resource-overview.tsx` and `dashboard-placeholder-page.tsx` are dead code; delete them.

### M8: Lead generation (≈ 90%)
- **USE-2** *(S)*: the lead form validates only after submit, not while the visitor types.
- **UI-41** *(S)*:
  - the status counts ignore the filters;
  - there is no chatbot filter in the UI (the API has one);
  - CSV export stops at 5,000 rows.
- **DATA-10** *(S)*:
  - "Forget this customer" deletes leads without sending `lead.deleted` webhooks;
  - old webhook delivery records are never purged.

### M9: Support escalation (≈ 93%)
- **Skill-based routing, optional** *(M)*: round-robin exists. Routing by topic or skill (e.g. billing questions go to the billing team) is not built.

### M10: Knowledge base (≈ 86%)
- **Pinecone and Firecrawl** ⚠️: see §3. Alternative to Pinecone: pgvector in the existing Postgres.
- **Cloud storage for files** *(M)*: uploaded knowledge files are stored on the server volume. Move them to Cloudinary or S3 so redeploys and extra instances can't lose them.
- **FE-3 delete** *(S)*: it is a hard delete (audit-logged); the SDS shows a DELETED state. Change it or document it.
- **OCR for scanned PDFs** *(M)*: scanned PDFs have no text layer, so nothing is indexed.

### M11: Integrations & customization (≈ 82%)
- **Live HubSpot and Shopify runs** ⚠️: see §3.
- **HubSpot retry** *(S)*: failed lead syncs are retried only with "Sync now". Add an automatic retry sweep.
- **Two-way CRM sync** *(M)*: HubSpot → AssistDesk.
- **More connectors** *(M each)*: Salesforce, Zendesk, WooCommerce.
- **Public API write endpoints** *(M)*: update or close tickets, knowledge content, webhook management.
- **Custom roles** *(M)*: they change only the eleven listed permissions; other pages follow the base role level. Widen the list if needed.
- **Audit-log retention** *(S)*: a setting to delete old audit entries.

---

## 5. Cross-cutting work

### 5.1 Security
- **SEC-21** *(S–M)*:
  - a login session is issued before the email is verified;
  - `/setup` and the APIs don't check verification;
  - the sign-up rate limit trusts the `X-Forwarded-For` header.
- **SEC-17** *(S)*:
  - a changed profile email is not verified again;
  - invited users are marked verified without clicking a link.
- **SEC-28 / 33 / 34, DNS rebinding** *(M, one shared fix)*: the SSRF guard, webhooks and HTTP tools check DNS and then fetch separately. Pin the resolved IP with a custom dispatcher.
- **SEC-29** *(M)*: uploaded files are public to anyone with the URL. Use signed or expiring links for chat attachments.
- **SEC-14** *(S–M)*: security headers are in place except a `script-src` Content Security Policy.
- **BUG-14** *(S)*: creating a duplicate inbox at the same moment, or bulk-creating users, gives a 500 instead of a 409 (no transaction).
- **BUG-15** *(S–M)*:
  - a few routes still call `request.json()` unguarded (`ai-agents/[id]/automations`, `settings`);
  - many don't check the types of body fields.
- **DATA-07** *(S)*: add a database index on `Integration.webhookSecret` (it is now the inbound lookup key).

### 5.2 Accessibility
- **A11Y-02** *(S)*: labels aren't linked to their inputs in `setup-wizard.tsx`, `connectors-workspace.tsx`, `api-keys-workspace.tsx` and `roles-workspace.tsx`.
- **A11Y-04** *(S)*: the agents drawer can still be focused with the keyboard when it is closed (add `inert`).
- **A11Y-06** *(S, one theme token)*: grey `text-slate-500` text on black is below the WCAG AA contrast ratio.
- **UI-23** *(S)*: no validation while typing on login, the setup wizard, domain fields and the colour field.

### 5.3 Operations and tooling
- **OPS-03** *(S)*: `@stripe/stripe-js` and `@deepgram/sdk` are installed but unused (Stripe uses its hosted checkout; Deepgram is called directly). Remove them or note why they stay.
- **OPS-05** *(S)*: `AGENTS.md` says to read Next.js docs in `node_modules/next/dist/docs`, but that folder doesn't exist in the installed Next.js 15.5. Correct or remove the note.
- **OPS-10** *(S)*: the end-to-end and demo scripts still run on PGlite with retries. Point them at a real local Postgres for stable runs.

### 5.4 Documentation
- **ROADMAP.md** *(S)*: it is still titled "Roadmap to 60%". Add a final-phase section that points to this file.
- **VERIFICATION_REPORT.md** *(S)*:
  - re-score M7 (the API Keys page is real) and M8 (API access exists);
  - mark refused tool requests (M2 SEC-2) as logged;
  - update §5.2 after the Priority-1 fixes.
- **Module docs** *(S)*: check that each `M…` doc's "Limitations" section matches this file.

---

## 6. Accepted limitations (explain in the report, no code needed)

- **AI-18:** free models call tools less reliably than paid ones.
- **SEC-36:** tool results are passed to the model; they are filtered, but a malicious business API could still try to steer it.
- **AI-14:** the buying-intent trigger for the lead form uses keywords; the AI's `capture_lead` action covers the rest.
- **AI-16:** without an embedding model, FAQ and gap groups are matched on wording only.
- **AI-19:** sentiment for escalation uses a word list (English, Roman Urdu, Urdu), not an ML model; the threshold is adjustable.
- **AI-11:** the semantic score thresholds are tuned to `text-embedding-3-small`; re-tune them if the model changes.
