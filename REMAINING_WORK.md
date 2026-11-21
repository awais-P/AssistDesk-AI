# AssistDesk: Remaining Work (M1–M11)

> **Written:** 16 Nov 2026, after Modules 9, 11 and 3 were finished and pushed (`91d0e72`, `b9b3c8e`, `607b8c0`).
> **How it was checked:** every open gap in [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md) §4–§5, every open item in the local issue register, each module doc's "Limitations" section and the SRS feature lists were re-checked against today's code (file and line evidence collected on 16 Nov). Items fixed since October are listed in §6 so the documents can be corrected.
> **Related:** [ROADMAP.md](ROADMAP.md) · [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md) · [CHANGELOG.md](CHANGELOG.md) · module docs `M2_…`–`M11_…`

Effort: **S** = under half a day · **M** = 1–2 days · **L** = 3+ days. ⚠️ = needs an outside account or key that only the team can create.

---

## 1. Where each module stands

| # | Module | Verified now | Biggest thing missing |
|---|---|---|---|
| M1 | Assistant creation & omnichannel | ≈ 84% *(voice calls 18 Nov)* | Slack OAuth; WhatsApp media |
| M2 | Agentic tools | ≈ 94% *(refunds + invoice links, 20 Nov)* | Shopify actions tested against a fake Shopify only |
| M3 | Subscription & payment | ≈ 82% | One run against a live Stripe test account; tax |
| M4 | Monitoring & analytics | ≈ 84% | KPI auto-refresh; pre-aggregation for big tenants; three SRS definitions differ |
| M5 | Real-time context & sessions | ≈ 88% *(token streaming 17 Nov, voice under the same customer 18 Nov)* | Multi-instance real time |
| M6 | LLM management & fast inference | **≈ 80%** *(FE-5 streaming 17 Nov; voice FE-6–8 18 Nov, verified with real calls)* | < 500 ms: measured 1.1–2.8 s end of speech to first audio on free tiers in dev; needs Groq's paid tier and a production measurement |
| M7 | User dashboard | ≈ 92% *(Chats reply box, 19 Nov)* | Unsaved-changes prompt; "System Bot" entries in the thread |
| M8 | Lead generation | ≈ 90% *(API access now exists)* | Scheduled webhook retries; inline validation |
| M9 | Support escalation | ≈ 93% *(email/Slack alerts and round-robin routing, 20 Nov)* | Skill-based routing; sentiment is a lexicon scorer |
| M10 | Knowledge base | ≈ 86% *(bulk actions, progress bar, .doc, 19 Nov)* | Pinecone/Firecrawl not configured; files on the volume, not cloud storage |
| M11 | Integrations & customization | ≈ 82% | Live HubSpot/Shopify test; more connectors; API write endpoints |
| | **Overall (equal weight)** | **≈ 87%** *(21 Nov; was ≈ 79% on 16 Nov and ≈ 63% on 10 Oct)* | M6 (≈ 80%) is the lowest; no module is far behind |

**Takeaway:**
- **Voice:** one piece of work, a **voice channel** (speech in, LLM, streaming speech out), would lift four modules at once: M6 FE-6–8, M5 FE-2, M9 FE-2 and M1 FR-16.6. It is the largest remaining block.
- **Everything else** is a list of small and medium fixes.

---

## 2. Recommended order before the final evaluation

### Priority 1: fix before the demo (correctness, security, things an examiner can switch on)

> ✅ **All ten done on 16 Nov 2026** (see CHANGELOG "Priority-1 fixes"; tests UT-61–UT-63, IT-28, UI-P1-01…03). #8 is partial: there is no script-src CSP because Next.js adds inline scripts without a nonce. Found on the way: the partner's email-verification migration locked out every existing account (DATA-11), fixed by a follow-up migration.

| # | Item | Module / ID | Effort |
|---|---|---|---|
| 1 ✅ | **Webhook secret visible to every role.** `GET /api/integrations` has no role check and returns `webhookSecret` (`src/lib/integrations/serialize.ts:25`), so any Agent can read the email webhook secret and forge inbound emails. Mask it and show it to Admins only. | M11 / SEC-19 | S |
| 2 ✅ | **Block-list never matches domains or keywords.** It checks `rules.includes(email)` (`ticket-workflow.ts:661`). On the direct email path (`email-ingestion.ts`) a blocked sender still gets an AI reply. | M1 / BUG-03 | S |
| 3 ✅ | **Auto-assign runs even when "Assign To" is off.** It falls back to the oldest user (`ticket-workflow.ts:549-555`). | M1 / BUG-05 | S |
| 4 ✅ | **Settings that do nothing** (UI-44, BUG-06): "AI Follow-up" and "Close Ticket" automations, the chatbot "Email notifications" toggle (FR-13.8), and inbox `autoReplyEnabled` (FR-15.5). Implement or hide each one. Implementing means an inactivity job for the two automations, sending the email notification, and an auto-reply template with sending. | M1, M7 | S to hide / M to build |
| 5 ✅ | **Schedule the background jobs.** Session expiry, knowledge-job recovery and **lead-webhook retries** run only when `/api/cron/*` is called, and nothing calls it (no `vercel.json`, `CRON_SECRET` empty). Add in-process timers in `instrumentation.ts`, like email polling, SLA and billing already have, plus a `vercel.json` for hosting. | M5, M8, M10 / OPS-13 | S |
| 6 ✅ | **Playground has no limits.** No rate limit and no plan limit, so any user can spend the managed AI keys. Add the `aiTestPerUser` limiter and `aiReplyAllowed`. | M5 / SEC-39 | S |
| 7 ✅ | **Internal errors returned to the client.** Knowledge-source routes send the raw Prisma `error.message` (`knowledge-sources/route.ts:256`, `[id]/route.ts:331`). | M10 / SEC-16 | S |
| 8 🟡 | **No security headers.** Add CSP, `frame-ancestors` and `X-Frame-Options` for the dashboard (the widget stays frameable), plus an Origin check on state-changing requests. | All / SEC-14 | M |
| 9 ✅ | **Migrate every developer database.** Each dev DB (including `assistdeskDb`) needs `npx prisma migrate deploy` for the M9, M11, M3 and partner index migrations. | Ops | S |
| 10 ✅ | **Clean the partner's lint errors.** 35 `no-explicit-any` errors in `email-verification.test.ts` and `password-reset.test.ts`, plus unused `Skeleton` imports in three `loading.tsx` files. `npm run lint` must be green for the "lint, test, build" rule. | Ops | S |

### Priority 2: biggest score gains

| # | Item | Lifts | Effort |
|---|---|---|---|
| 11 ✅ | **Token streaming of AI replies** *(done 17 Nov: widget and Playground, all providers and the LangGraph engine, first-word time recorded; see CHANGELOG)*. Stream LLM deltas over the existing SSE channel to the widget and Playground. It is needed by the SRS events and by voice. | M5, M6 FE-5/FE-8 | M |
| 12 ✅ | *(built 18 Nov and verified with real calls: Deepgram Nova-3 speech-to-text with endpointing, streamed Groq Qwen 3.8 reply, Aura-2 streaming speech, barge-in; first audio 1.1–2.8 s on free tiers; see CHANGELOG)* **Voice channel** ⚠️ (Deepgram key, plus Cartesia or ElevenLabs): <ul><li>browser microphone → Deepgram streaming speech-to-text with VAD (FE-7);</li><li>Groq LLM with token streaming;</li><li>streaming TTS over WebSocket (FE-8);</li><li>a measured response time against the 500 ms target (FE-6, PER-1);</li><li>sessions under the same Contact (M5 FE-2) and the call transcript in the escalation brief (M9 FE-2).</li></ul> `@deepgram/sdk` is already installed. | M6, M5, M9, M1 | L |
| 13 ✅ | *(done 19 Nov: attachments, emoji, online dot, avatars; see CHANGELOG)* **Agent attachments and emoji in Chats** (FR-6.6/6.7). The reply box is a plain textarea; reuse the widget's upload route and emoji picker. Also add the customer presence dot (FR-6.2) and avatars in the list (FR-6.1). | M7 | M |
| 14 ✅ | *(done 19 Nov: bulk select with re-index and delete, upload progress bar, .doc files, sidebar under AI; see CHANGELOG)* **Knowledge base table:** <ul><li>bulk checkboxes with bulk delete and re-index (FR-10.6);</li><li>an upload progress bar (XHR `upload.onprogress`);</li><li>`.doc` support;</li><li>move "Knowledge base" to the AI group of the sidebar (FR-10.1).</li></ul> | M10 | M |
| 15 | **Configure Pinecone and Firecrawl** ⚠️ (free keys) and record one run, so FE-1 and FR-10.3 are shown working instead of "coded but not configured". | M10 | S |
| 16 | **Live third-party runs** ⚠️ (test accounts). For each, run once and record the result in the module doc: <ul><li>Stripe test keys and the Stripe CLI (OPS-18);</li><li>HubSpot developer portal and Shopify development store (OPS-17);</li><li>Slack app and WhatsApp test number;</li><li>SMTP.</li></ul> | M1, M3, M11 | M total |
| 17 ✅ | *(done 20 Nov: AI collects refund requests, the team approves them on the Refunds page and Shopify orders are refunded; built-in invoice links; see CHANGELOG)* **Refund action** with customer confirmation (Stripe or Shopify refund), and a built-in invoice tool instead of the demo HTTP template. | M2 FE-1 | M |
| 18 ✅ | *(done 20 Nov: email and Slack alerts for new and overdue escalations, round-robin routing among chosen or online members; see CHANGELOG)* **Escalation alerts by email and Slack** (reuse the M8 notifier), and simple round-robin or team routing. | M9 | M |
| 19 | **Rewrite SDS Chapters 3–5.** The SDS still describes the 30% system ("custom TypeScript runtime", "30% coverage", 17 of 36 models, 5 unit tests). Update the class and sequence diagrams for M2, M3, M5, M8, M9 and M11, and replace the Chapter 5 test tables with the real suites (≈ 325 unit, 155 integration, Playwright UI). | Docs / DOC-07, DOC-01 | L |
| 20 ✅ | *(done 21 Nov: TanStack Query for the knowledge base list, its polling and bulk actions; Zustand for the table view kept per tab; see CHANGELOG)* **SRS tech promised but unused:** Zustand and TanStack Query (SRS CON-2). Use them on one real page (Chats or the KB list), or change the SRS and remove them. | Docs / DOC-03 | M |

### Priority 3: polish and future work

The rest of the list (§3 and §4). Pick items as time allows.

---

## 3. Detailed list by module

### M1: Assistant creation & omnichannel (≈ 80%)
- [x] **FE-1:** "AI Follow-up" and "Close Ticket" automations have no runner (`agent-automations.ts:42,51`). (P1 #4) ✅ *16 Nov*
- [ ] **FE-3 / FR-16.5:** Slack connects with a pasted bot token; the SRS asks for OAuth (`oauth.v2.access`). (M)
- [ ] **FE-3:** WhatsApp handles text and buttons only; add images, documents and voice notes. (M)
- [ ] **FE-3:** Slack, WhatsApp and SMTP have never run against real accounts ⚠️. (P2 #16)
- [x] **FR-16.6:** voice channel: a call button in the website chat. (P2 #12) ✅ *18 Nov*
- [ ] **FR-3.6:** the training step in the setup wizard can be skipped; the SRS says it is required. (S)
- [ ] **FR-2/4:** the inbox-prefix availability check runs on click, not live while typing (debounced). (S)
- [ ] **FR-8.1:** editing an agent opens a full page, not a side drawer. Build the drawer or record the deviation. (S to document)
- [ ] **FR-14.8:** "empty = unlimited" is impossible (range 1–1000). (S)
- [ ] **FR-17.x widget:** the header dot follows the AI, not humans online; no read receipts; AI and human bubbles look the same; "voice" is browser dictation. (M)
- [ ] **Backend:** deleting an agent is a hard delete (it is now audit-logged); the SDS describes a soft delete. (S)
- [x] **BUG-03, BUG-05:** block-list and auto-assign. (P1 #2, #3) ✅ *16 Nov*
- [ ] **BUG-19:** typing an agent name in the setup wizard overwrites a custom system prompt; retrying a partial URL save re-submits saved URLs. (S)
- [ ] **BUG-25:** a message with only an attachment is answered using the file name as the question. (S)
- [ ] **AI-07:** ticket "AI" priority is a regex; bare `down` matches "download". Use word boundaries or an LLM call. (S)
- [ ] **UI-24:** domain and URL chips in the setup wizard can't be removed. (S)

### M2: Agentic tools (≈ 88%)
- [x] **FE-1:** refund action: the AI requests, the team approves, Shopify refunds. (P2 #17) ✅ *20 Nov*
- [x] **FE-1:** built-in `get_invoice` action with a printable invoice link (Shopify or sample-store orders). ✅ *20 Nov*
- [ ] **FE-1:** the `shopify_order_status` built-in has only been tested against a fake Shopify ⚠️. (P2 #16)
- [ ] A **confirm button in the widget** for actions that change data. Today confirmation is word rules (SEC-35). (M)
- [ ] Appointment reminders and calendar sync (Google/Outlook) ⚠️. (M)
- [ ] **SEC-34:** custom HTTP tools check DNS, then fetch (DNS rebinding). Pin the resolved IP; optional per-workspace host allow-list. (M, shared with SEC-28/33)
- [ ] **Accepted, document only:** AI-18 (uneven tool calling on free models), SEC-36 (tool output passed to the model).

### M3: Subscription & payment (≈ 82%)
- [ ] One end-to-end run with **live Stripe test keys and the Stripe CLI** ⚠️; record it in `M3_SUBSCRIPTION_PAYMENT.md` (OPS-18). (S once keys exist)
- [ ] Tax/VAT (Stripe Tax) and currencies other than USD. (M)
- [ ] Count AI-reply usage per billing period instead of per calendar month. (S)
- [ ] Workspaces already over a plan's limit are not cut back (limits apply to new items only); decide and document. (S)
- [ ] A billing-flow browser test that uses its own workspace (so the shared demo workspace isn't limited). (S)

### M4: Monitoring & analytics (≈ 84%)
- [ ] **FR-11.1:** KPI cards refresh only on load; add interval polling like Live Sessions. (S)
- [ ] **FR-11.2 / 11.3 / 11.5, latency definition:** implemented differently from the SRS (documented in the M4 doc §8). Align them or keep the documented deviation. (S to M)
- [ ] **PER-2 (≤ 2 s):** never measured; analytics aggregate raw rows (OPS-11). Measure once; add rollup tables if slow. (M)
- [ ] **UI-42:** customer and ticket reports ignore the channel filter; Improve lists are capped. (S)
- [ ] **AI-16:** without an embedding model, FAQ and gap groups use wording only (accepted).

### M5: Real-time context & sessions (≈ 80%)
- [x] **FE-2:** voice in the shared Contact: each call is a VOICE conversation under the same customer. (P2 #12) ✅ *18 Nov*
- [x] **FE-5:** schedule the cron. (P1 #5) ✅ *16 Nov*
- [ ] **FE-5:** the EMAIL and VOICE expiry policies (`session-lifecycle.ts:35-36`) are defined but never used. Use or remove them. (S)
- [x] **FE-6:** Playground rate limit. (P1 #6) ✅ *16 Nov*
- [x] **Streaming:** replies are streamed token by token to the widget and Playground. (P2 #11) ✅ *17 Nov*
- [ ] **SRS event:** a widget request from an unauthorised origin returns 403 but is not logged. Add an audit entry (`chatbot-widget.ts:97`, `widget/[widgetId]/page.tsx:66`). (S)
- [ ] **PER-3 / OPS-09:** real-time push is in-process; across instances it's a 2 s poll. Use Postgres LISTEN/NOTIFY or Redis to scale out. (M)
- [ ] **SEC-31:** typed email/phone links a visitor to a Contact without verification (memory is redacted). Email OTP before linking. (M)
- [ ] **SEC-32:** any role can edit a customer's AI memory (PATCH has no role check). (S)
- [ ] **UI-39:** Contacts list stops at 100 and fills with "Anonymous visitor". Add paging and a "hide anonymous" filter. (S)

### M6: LLM management & fast inference (≈ 37%), the main gap
| FE | Requirement | Now | To do |
|---|---|---|---|
| FE-1 | Multiple LLM models | ✅ 6 providers | — |
| FE-2 | Business picks the model | ✅ per agent, own key | — |
| FE-3 | Feedback loop | ✅ 👍/👎 → Improve → knowledge base | Optional: use feedback automatically (e.g. prefer the better-rated model) |
| FE-4 | Keep knowledge updated from new training data | ◐ | Schedule the knowledge recovery job (P1 #5) |
| FE-5 | Faster, more relevant responses | ✅ token streaming (chat, Playground, after the lead form), first-word time measured and shown in Playground and Analytics, 40 s HTTPS keep-alive, busy-model cooldown, retired-model memory, cached question embeddings, hybrid retrieval | Optional: a Groq key in production (the free OpenRouter models take 0.7–10 s to the first word) |
| FE-6 | High-speed inference (Groq/vLLM), voice answer < 500 ms | ◐ Groq is the default managed model | Voice pipeline and a measured first-audio time (P2 #12) |
| FE-7 | Voice Activity Detection | ✅ Deepgram endpointing (300 ms) and utterance end (1 s), barge-in *(18 Nov)* | Deepgram streaming with VAD/endpointing ⚠️ (P2 #12) |
| FE-8 | WebSocket streaming TTS that starts before the LLM finishes | ✅ phrases of the streamed reply go to Deepgram Aura-2 as they are written *(18 Nov)* | Streaming TTS (Cartesia/ElevenLabs/Deepgram Aura) fed by streamed tokens ⚠️ (P2 #12) |

- [ ] **Groq key** ⚠️: the free Groq key is empty locally, so replies go through slow free OpenRouter models (7–12 s). Add one before the demo (AI-10).

### M7: User dashboard (≈ 86%)
- [x] **FR-6.6 / 6.7:** attachments and emoji in the Chats reply box. (P2 #13) ✅ *19 Nov*
- [x] **FR-6.1 / 6.2:** avatars in the chat list; customer presence dot. (P2 #13) ✅ *19 Nov*
- [ ] **FR-6.8:** "System Bot" entries are shown inside the thread. (S)
- [ ] **FR-15.1:** no unsaved-changes prompt on any form (`beforeunload` / route-leave guard). (S)
- [x] **FR-15.5 / UI-21:** inbox auto-reply. There is no toggle (hard-coded `true`), no template choice and no sending. (P1 #4) ✅ *16 Nov*
- [ ] **FR-5.4:** no separate advanced-filter panel on Tickets. (S)
- [ ] No user avatar upload on the profile. (S)
- [ ] **BUG-26:** Agents see ticket Delete buttons (the server refuses); creating and renaming tags has no role check. (S)
- [ ] **BUG-27:** deleting every prompt template brings the 3 defaults back. (S)
- [ ] **UI-32:** Inboxes and Agents show "No … match the current search" when nothing exists. (S)
- [ ] **UI-37:** `workspace-resource-overview.tsx` and `dashboard-placeholder-page.tsx` are dead code; delete them. (S)

### M8: Lead generation (≈ 90%)
- [x] **CI-3:** webhook retries need the scheduler. (P1 #5) ✅ *16 Nov*
- [ ] **USE-2:** the lead form validates only after submit, not as the user types. (S)
- [ ] **UI-41:** status counts ignore the filters; no chatbot filter in the UI (the API has one); CSV export caps at 5,000 rows. (S)
- [ ] **DATA-10:** "Forget this customer" deletes leads without sending `lead.deleted` webhooks; old webhook delivery payloads are never purged. (S)
- [ ] **AI-14:** the buying-intent trigger is keyword-based (accepted; the AI `capture_lead` action covers the rest).

### M9: Support escalation (≈ 85%)
- [x] **FE-2:** voice call transcript in the hand-over brief. (P2 #12) ✅ *18 Nov*
- [x] Round-robin auto-assignment (chosen members, online only). (P2 #18) ✅ *20 Nov* — skill-based routing is not built.
- [x] Email and Slack escalation alerts. (P2 #18) ✅ *20 Nov*
- [ ] **AI-19:** sentiment is a lexicon scorer, not a model (accepted; tunable).
- [x] **OPS-16:** the SLA check runs in every server process; a serverless host needs the scheduler. (P1 #5) ✅ *16 Nov*

### M10: Knowledge base (≈ 78%)
- [ ] **FE-1:** Pinecone coded but not configured ⚠️; or switch to pgvector. (P2 #15)
- [ ] **FR-10.3:** Firecrawl coded but not configured ⚠️. (P2 #15)
- [x] **FR-10.6:** bulk checkboxes with re-index and delete. (P2 #14) ✅ *19 Nov*
- [x] **FR-10.2:** `.doc` files and an upload progress bar. (P2 #14) ✅ *19 Nov* — files are still on the server volume, not cloud storage.
- [x] **FR-10.1:** Knowledge base is in the AI group of the sidebar. ✅ *19 Nov*
- [ ] **FE-3:** delete is a hard delete (now audit-logged); the SDS shows a DELETED state. (S)
- [x] **FE-4:** the recovery cron isn't scheduled. (P1 #5) ✅ *16 Nov*
- [ ] OCR for scanned PDFs. (M)
- [x] **SEC-16:** raw error messages. (P1 #7) ✅ *16 Nov*
- [ ] **AI-11:** semantic score calibration is tuned to `text-embedding-3-small`; re-tune if the model changes (accepted).

### M11: Integrations & customization (≈ 82%)
- [ ] Live HubSpot portal and Shopify store run ⚠️ (OPS-17; the Shopify API version `2024-10` needs a check). (P2 #16)
- [ ] Retry sweep for failed HubSpot syncs (today only "Sync now"). (S)
- [ ] More connectors: Salesforce, Zendesk, WooCommerce. (M each)
- [ ] Two-way CRM sync (HubSpot → AssistDesk). (M)
- [ ] Public API write endpoints: update/close tickets, knowledge content, webhook management. (M)
- [ ] Custom roles cover the ten listed permissions only; other pages follow the base level. (M to widen)
- [ ] Audit-log retention setting. (S)
- [x] **SEC-19:** webhook secret. (P1 #1) ✅ *16 Nov*

---

## 4. Cross-cutting

### Security (not tied to one module)
- [x] **SEC-14:** security headers and Origin check. (P1 #8) 🟡 *16 Nov: done except a script-src CSP*
- [ ] **SEC-17:**
  - a changed profile email is not re-verified;
  - invited users are marked verified without a click.

  (S)
- [ ] **SEC-21:**
  - a session is issued before the email is verified;
  - `/setup` and the APIs don't check verification;
  - the sign-up IP limit trusts `X-Forwarded-For`.

  (S–M)
- [ ] **SEC-28 / 33 / 34:** DNS-rebinding gap in the SSRF guard, webhooks and HTTP tools. Pin the resolved IP with a custom dispatcher. (M, one shared fix)
- [ ] **SEC-29:** uploaded files are public to anyone with the URL; use signed or expiring links for chat attachments. (M)
- [ ] **BUG-14:** a duplicate inbox created in a race, and bulk user creation without a transaction, give 500s instead of 409s. (S)
- [ ] **BUG-15:** a few routes still call `request.json()` unguarded (`ai-agents/[id]/automations`, `settings`), and many don't type-check body fields. (S–M)
- [ ] **DATA-07:** index `Integration.webhookSecret` (now the inbound lookup key). (S)

### Accessibility (SRS usability)
- [ ] **A11Y-02:** labels not linked to inputs in `setup-wizard.tsx` (0/10), `connectors-workspace.tsx`, `api-keys-workspace.tsx` and `roles-workspace.tsx`. (S)
- [ ] **A11Y-04:** the agents drawer stays focusable when closed (no `inert`). (S)
- [ ] **A11Y-06:** `text-slate-500` on black is below the AA contrast ratio (used 360 times). (S, a theme token)
- [ ] **UI-23:** inline validation is missing on login, the setup wizard, domains and the hex colour field. (S)

### Operations and tooling
- [x] **OPS-13:** cron scheduling. (P1 #5) ✅ *16 Nov*
- [ ] **OPS-05:** `AGENTS.md` (included by `CLAUDE.md`) says the project uses a newer Next.js with docs in `node_modules/next/dist/docs`, but the installed version is 15.5.15 and that folder doesn't exist. Correct or remove the note. (S)
- [ ] **OPS-03 / DOC-03:** unused packages `@deepgram/sdk` (until voice), `@stripe/stripe-js`, `zustand`, `@tanstack/react-query`. (P2 #20)
- [ ] **OPS-10:** the E2E and demo scripts still run on PGlite with retries; the integration tests are fine. (S)
- [ ] A production build check (`next build`) before the final evaluation, on a machine with enough memory. (S)
- [ ] Test IDs: both members should take the next free IDs (**UT-61**, **IT-28**) and list them in `tests/ui/README.md`. Avoid repeats like the UT-55/UT-56 clash.

### Documentation for the final evaluation
- [ ] **SDS Chapters 3–5.** (P2 #19)
- [ ] **ROADMAP.md:** it is still titled "Roadmap to 60%". Add a final-phase section pointing to this file and update the M7, M8 and overall rows. (S)
- [ ] **VERIFICATION_REPORT.md:**
  - re-score M7 (API Keys page now real) and M8 (API access now exists);
  - mark SEC-2 refusals as logged;
  - update §5.2 after the P1 fixes.

  (S)
- [ ] **Final report and deck** (in `testenv/report`): rebuild with M9, M11 and M3, the new test totals and screenshots. (M)
- [ ] **Demo script** for the final: the 60% walkthrough plus escalation, the API key, a connector, billing and (if built) voice. (S)

---

## 5. Needs an account or key from the team ⚠️

| Service | For | Free option |
|---|---|---|
| Groq | Fast replies in the demo (M6) | Free API key |
| Stripe | Live checkout run (M3) | Test mode keys + Stripe CLI |
| HubSpot | Live lead sync (M11) | Developer test portal |
| Shopify | Live order-status action (M11, M2) | Partner development store |
| Slack / WhatsApp | Live channel runs (M1) | Slack workspace; Meta WhatsApp test number |
| Pinecone / Firecrawl | M10 FE-1, FR-10.3 | Free tiers |
| Deepgram + Cartesia/ElevenLabs | Voice (M6, M5, M9, M1) | Free credits |

Never put these keys in the repository; `.env` and `.env.demo` only.

---

## 6. Fixed since the October verification (correct the documents)

| Item | Now |
|---|---|
| UI-03 API Keys page | Real page with create, show-once, revoke (M11). |
| M8 FE-4 API access | `/api/v1/leads` with `leads:read` / `leads:write`. |
| M2 SEC-2 refused tool requests | Logged as `access.denied` in the audit log. |
| SEC-11 email cross-tenant | Inbound mail is matched by the webhook secret or a login-verified Gmail mailbox, not by a free-text address. |
| M1 FE-3 email | Gmail mailbox polling turns real emails into tickets. |
| Agent and knowledge-source deletes | Now audit-logged (still hard deletes). |
| UI-34 developer copy | Removed (left only on the unreachable placeholder page). |
| A11Y-05 mobile tables | Scroll horizontally. |
| OPS-02 setup | `.env.example`, `docker-compose.yml` and a setup README exist. |
| Partly: BUG-03 | The deferred AI reply is skipped for a CLOSED ticket; domain rules and the direct email path remain. |
| Partly: SEC-17, SEC-21 | Email format validated everywhere; email verification on sign-up. |
| Partly: BUG-14, BUG-15, DATA-07, UI-21, UI-23, UI-24, UI-32, A11Y-02/03/04/06, OPS-03 | See the items above for what remains. |
