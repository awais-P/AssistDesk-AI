# AssistDesk — Change Log

Every big chunk of work gets an entry here: **date**, **module**, **files touched**, and what was **added / fixed / updated**.
Newest entries go on top. Vulnerability IDs (e.g. `SEC-03`) refer to [VULNERABILITIES.md](VULNERABILITIES.md); phase IDs refer to [ROADMAP.md](ROADMAP.md).

Entry template:

```
## YYYY-MM-DD — <short title>
**Module:** Mx – <name>   **Roadmap phase:** Px   **Author:** <name>
**Files:**
- path/to/file.ts
**Added:** ...
**Fixed:** ... (closes SEC-xx, BUG-xx)
**Updated:** ...
**Notes / follow-ups:** ...
```

---

## 2026-09-30 — Module 4 (Monitoring & Analytics) completed
**Module:** M4 (bonus: M6 FE-3 feedback loop)   **Roadmap phase:** P5   **Author:** Claude (with Muhammad Awais)
**Result:** M4 ≈ 40% → ≈ 90%. All five features and the whole analytics mock-up M-11 (FR-11.1–11.7) run on real data. Tool-action analytics will come with M2. Full write-up and demo script: **[M4_ANALYTICS.md](M4_ANALYTICS.md)**.

**Database: migration `20260930150000_module4_analytics`:**
- New **`AiInteraction`** analytics store: one row per customer-facing AI reply (question, latency, tokens, model, confidence, grounded, fallback, sources, review state). Recorded in `conversation-runtime.ts` (widget, WhatsApp, Slack) and `ticket-workflow.ts` (email); playground tests are excluded.
- New **`MessageFeedback`** (👍/👎 plus an optional comment per AI reply).

**Added:**
- **Analytics logic** (`src/lib/analytics.ts`, `src/lib/analytics-math.ts`):
  - ranges 24h/7d/30d/90d/custom (max 180 days), channel filter, workspace time zone, previous-period comparison;
  - FR-11 KPIs; 24 hourly latency buckets (avg, p95, gaps); daily volume by channel; resolution mix; channels; activity heatmap; recent interactions; per-agent quality;
  - FAQ clustering (word overlap, containment, light stemming, semantic embeddings when configured);
  - customer behaviour, leads and tickets reports;
  - improvement areas: knowledge gaps, unhelpful replies, escalation reasons, unanswered.
- **APIs:**
  - `GET /api/analytics`, `/live` (FR-11.4 polling), `/reports`, `/improvements`;
  - `POST /api/analytics/interactions/review` (Manager+);
  - `GET /api/analytics/export?type=interactions|conversations|faq` (CSV, anonymised, Manager+);
  - `GET /api/chat-sessions/[id]/transcript` (text/JSON, FE-2);
  - `POST /api/widget/[id]/feedback`.
- **Analytics pages** (sidebar "Analytics"; the ticket Reports page stays):
  - shared `analytics-nav.tsx` (tabs, date range, channel);
  - **Overview:** FR-11.1–11.4 KPI cards with live polling, secondary metrics, 24-hour latency chart with tooltips, volume chart, resolution mix, channels, recent interactions with channel icons and green/amber status, agent table, exports;
  - **Reports:** FAQ with filter and sort, customer behaviour with heatmap, leads, tickets;
  - **Improve:** knowledge gaps with "Add answer to knowledge base" (saved as a Q/A text source and marked handled) and "Mark as handled"; unhelpful replies; escalations; unanswered conversations.
  - All charts are inline SVG; no new dependency.
- **Widget:** 👍/👎 on every AI reply, with an optional "What was missing?" note; the rating is restored on reload.
- **Tests:** `tests/unit/analytics.test.ts` (16 cases; the suite now has 113) and a 43-check end-to-end script (see M4 doc §6).

**Fixed:**
- **UI-04:** there were no FR-11 analytics.
- New **AI-15:** FAQ grouping missed "deliver/delivery" and short questions contained in longer ones.
- The knowledge-gap review limit (200 ids) is raised to 1,000.

**Notes / follow-ups:**
- Tool analytics come with M2.
- Rollup tables are needed for large tenants (OPS-11).
- Wording-only knowledge-gap grouping (AI-16).
- Customer and ticket counts ignore the channel filter (UI-42).

---

## 2026-09-30 — Module 8 (Lead Generation System) completed
**Module:** M8 (bonus: FR-11.3 Leads KPI from M4)   **Roadmap phase:** P3   **Author:** Claude (with Muhammad Awais)
**Result:** M8 ≈ 10% → ≈ 92%. All five features (FE-1 to FE-5) and the SRS lead events are implemented. Full write-up and demo script: **[M8_LEAD_GENERATION.md](M8_LEAD_GENERATION.md)**.

**Database: migration `20260930090000_module8_leads`:**
- New `Lead` (with enum `LeadStatus` NEW / CONTACTED / QUALIFIED / CONVERTED / LOST), `LeadEvent` (timeline), `WebhookEndpoint`, `WebhookDelivery`.
- `Chatbot.leadForm` (JSON form config) and `ChatSession.leadState` (PROMPTED / CAPTURED / SKIPPED).
- `WorkspaceSetting.leadNotifyEmails`, `leadSlackWebhookUrl` (encrypted) and `autoCaptureLeads`.

**Added:**
- **FE-1 lead forms** (`src/lib/lead-form.ts`):
  - per-chatbot form: up to 8 fields (name/email/phone/company plus custom text, long text, number, dropdown), title/description/button/thank-you texts, marketing-consent checkbox, allow-skip;
  - trigger: buying intent / after N messages / after the first message;
  - server-side sanitising and per-field validation;
  - an inline card in the widget; the AI pauses while it is open and then answers the held question;
  - skip, or typing on, counts as skipped; asked once per conversation; survives a reload.
- **FE-2 automatic collection:**
  - known details (pre-chat fields, typed in chat, customer record) prefill the form or capture the lead without showing it;
  - emails and phones typed in any message are detected and linked to the Contact;
  - buying intent on WhatsApp/Slack from a reachable customer creates the lead (intent rules in English, Roman Urdu and Urdu; complaints excluded).
- **Lead service** (`src/lib/leads.ts`):
  - one open lead per customer (a returning customer updates it);
  - joins the M5 Contact (including the browser id);
  - score 0–100 with hot/warm/cold;
  - background "Interested in" summary;
  - timeline events; session context updated;
  - a lead line in customer memory.
- **FE-3 notifications:** dashboard alert, email to up to 10 team addresses (`sendTeamEmail` in `mailer.ts`), a Slack incoming-webhook message, a "Send test" button, and per-lead results logged (failures raise a warning).
- **FE-4 webhooks** (`src/lib/webhooks.ts`):
  - events `lead.created` / `lead.updated` / `lead.status_changed` / `lead.deleted`;
  - HMAC-SHA256 `X-AssistDesk-Signature` (`t=…,v1=…`) plus `X-AssistDesk-Delivery` for idempotency;
  - public-URL (SSRF) check, no redirects, 10 s timeout;
  - retries after 30 s / 2 min / 10 min, then FAILED with a timeline event and an alert;
  - delivery log with payloads; manual retry; secret shown once and rotatable;
  - `/api/cron/webhooks`, and retries also sent while the Leads page is open.
- **FE-4 export:** CSV of the filtered list with custom columns, UTF-8 BOM and CSV-injection defusing (Manager+).
- **FE-5 lead database:**
  - `/dashboard/leads`: status pills, search, filters (source, channel, temperature, owner, dates), sortable columns, pagination, add lead, export, settings;
  - `/dashboard/leads/[id]`: status/owner, edit, score breakdown, conversation, notes, timeline, deliveries, resend, delete;
  - `/dashboard/leads/settings`: notifications, auto-capture, webhooks.
- **Other UI:**
  - Chatbot → **Lead capture** builder with live preview (`lead-form-builder.tsx`);
  - Chats context panel **Lead** section with "Create lead";
  - **Leads** sidebar item;
  - Overview **Leads captured** KPI (FR-11.3).
- **APIs:**
  - `app/api/leads/**` (list, create, detail/patch/delete, notes, resend, export, settings, settings/test);
  - `app/api/webhooks/**` (CRUD, test, rotate, deliveries, retry);
  - `app/api/widget/[widgetId]/lead`; `app/api/cron/webhooks`.
- **Refactor:**
  - `respondToVisitor()` in `widget-conversation.ts`, shared by messages and the lead form;
  - pure identity helpers moved to `src/lib/identity.ts` (re-exported by `contacts.ts`).
- **Tests:** `tests/unit/leads.test.ts` (19 cases; the suite now has 97, all passing), a 72-check end-to-end script with a signature-verifying local receiver, and browser checks (see M8 doc §7).

**Fixed:**
- **UI-25:** there was no Leads page.
- New **BUG-30:** a lead-form submission created a second Contact, which made the customer look unverified.
- New **UI-40:** the widget asked for the email twice while the lead form was open.
- Lead deletion is race-safe (404 instead of 500).
- "Forget this customer" now deletes their leads too.

**Updated:**
- `.env.example`: `ASSISTDESK_ALLOW_PRIVATE_WEBHOOKS`, `/api/cron/webhooks`.
- The chatbot save API accepts `leadForm`; the Chats context API returns `lead` / `leadState`; the widget config returns the public form.

**Notes / follow-ups:**
- Rule-based intent detection (AI-14) will be complemented by the M2 `capture_lead` tool.
- There is no API-key access for external systems yet (M11).
- Email notifications need platform SMTP.
- Webhook DNS-rebinding window (SEC-33).
- Status counts are workspace totals (UI-41).
- The PGlite test DB is unreliable for concurrent requests (OPS-10).
- During testing the free AI tier hit its daily limit, so replies used the knowledge-base fallback.

---

## 2026-09-29 — Module 5 (Real-Time Context & Session Management) completed
**Module:** M5 (bonus: SEC-08, SEC-18, SEC-30, BUG-07, BUG-08, AI-08)   **Roadmap phase:** P1   **Author:** Claude (with Muhammad Awais)
**Result:** M5 ≈ 25% → ≈ 90%. All six features (FE-1 to FE-6) and all SRS backend events are implemented. Voice is deferred to Module 3. The full design, the "different scenario" and a demo script are in **[M5_SESSION_CONTEXT.md](M5_SESSION_CONTEXT.md)**.

**Database: migrations `20260929180000_module5_sessions`, `20260929190000_module5_email_threading`, `20260929200000_module5_session_visitor`:**
- New `Contact` model: one per customer, joining email / phone / WhatsApp / Slack / browser identities. It is the "Unified Memory Buffer".
- New `SessionEvent` audit trail and `RateLimitBucket` model.
- `ChatSession` gains:
  - `contactId`, `previousSessionId`;
  - `sessionTokenHash` (secret token, stored hashed);
  - `lastActivityAt`, `closedReason`, `resolution`;
  - `summary` / `summarizedMessageCount`, `messageCount` / `aiMessageCount`;
  - `clientIpHash`, `visitorId`.
- `Chatbot.sessionTimeoutMinutes` (30) and `rateLimitPerMinute` (10); `WorkspaceSetting.crossChannelMemory`; `Ticket.contactId`; `TicketMessage.externalId` (email Message-ID dedupe).
- The backfill sets counters and last activity on existing sessions.

**Added:**
- **Session lifecycle** (`src/lib/session-lifecycle.ts`):
  - start, continue, expire and close, with a reason and a resolution (AI resolved / handled by team / unanswered);
  - customer notices on close;
  - a closed session is final, and the next message starts a linked session.
- **Expiry policies per channel:** widget 30 min (configurable, plus a 24 h cap), Slack 4 h, WhatsApp 24 h, email 7 days, at least 60 min during human takeover. Expiry is applied lazily, when the Chats page loads, and from `/api/cron/sessions` (`CRON_SECRET`).
- **Customer identity** (`src/lib/contacts.ts`):
  - E.164 phone normalisation (`ASSISTDESK_DEFAULT_COUNTRY_CODE`, default 92);
  - find by any identifier, link new ones, merge duplicates; race-safe.
- **Memory** (`src/lib/session-memory.ts`):
  - the last 12 messages;
  - a rolling and final session summary (in the background via `after()`, with an extractive fallback);
  - a customer profile on close;
  - a `<customer_memory>` block with recent sessions on other channels (carried over immediately) and open tickets.
- **Privacy:**
  - masked email and phone;
  - **trust level**: memory for an unverified web visitor (who only typed an email or phone) has identifiers **redacted in code**;
  - unverified sessions are labelled in memory;
  - workspace toggle; memory edit/clear; "Forget this customer".
- **Widget:**
  - secret session token (header / `?session=`) and anonymous visitor id;
  - **End chat**; expiry warning; "New conversation — we still remember" divider;
  - 429 cooldown;
  - **SSE live updates** with a polling fallback.
- **Channels:**
  - WhatsApp and Slack use the same pipeline (contact, session policy, per-conversation limit with a one-time notice, memory);
  - Slack reads the user's email when the `users:read.email` scope is granted.
- **Email** (`src/lib/email-threading.ts`, `email-ingestion.ts`):
  - replies with `[PREFIX-NUMBER]` thread into their ticket, but only from the requester;
  - tickets reopen on reply; quoted text is stripped; HTML is converted to text;
  - Message-ID dedupe;
  - the AI runs after the webhook answers, and its reply uses the thread plus customer memory;
  - no AI follow-ups once a human has answered.
- **Rate limiting** (`src/lib/rate-limit.ts`), PostgreSQL, shared, fail-open, hashed keys:
  - widget per conversation (chatbot setting), per IP and per widget;
  - new sessions per IP; attachments per IP;
  - channel conversations; inbound email; login; signup; "Summarise now".
  - Every breach returns 429 + `Retry-After` and is logged.
- **Real time** (`src/lib/realtime.ts`): event bus plus SSE streams for the widget (`/api/widget/[id]/stream`) and the dashboard (`/api/chat-sessions/events`), with 2 s database polling for multi-instance setups. Measured 2–52 ms.
- **Dashboard APIs:**
  - `GET /api/chat-sessions` (filters + `include`);
  - `GET /api/chat-sessions/[id]/context`, `POST /api/chat-sessions/[id]/summary`;
  - `GET/PATCH/DELETE /api/contacts[/id]`, `GET/POST /api/cron/sessions`.
- **Dashboard UI:**
  - **Chats**: Open / Human / Closed / All, channel and search filters; live updates; expiry countdown; ended reason; *Customer & context* panel with summary, "Summarise now", "What the AI knows", other conversations, tickets and activity; deep links.
  - **Contacts**: list and detail with memory edit, timeline and forget (new sidebar item).
  - **Chatbot settings**: conversation timeout and message rate limit.
  - **Settings**: Cross-channel memory switch.
- **Tests:** `tests/unit/sessions-and-memory.test.ts` (31 cases; the suite now has 78, all passing), plus a 60-check end-to-end script run against the dev server (see M5 doc §12).

**Fixed:**
- **SEC-08:** public chat rate limits and length cap.
- **SEC-18:** the session id is no longer a bearer token; secret token, stored hashed.
- **SEC-30:** the in-memory login limiter is replaced by the shared DB limiter with hashed keys and 30 attempts per IP.
- **BUG-08:** email threading and dedupe; the webhook no longer waits for the LLM.
- **BUG-07:** email ticket numbers now retry on conflict.
- **AI-08:** email AI sees the full latest message and the thread; HTML is converted to text.
- New: the rate limiter used the database's local time (`NOW()`), which gave a wrong `Retry-After` on non-UTC databases; it now uses UTC.
- New: the demo seeder crashed on a fresh database (`adminUser` undefined).
- New: the in-session prompt refused to repeat details the customer had just given ("what was my order number?").
- New: reasoning-model thoughts leaked into summaries; only the tagged output is kept now.
- Dashboard replies and status changes go through the lifecycle: takeover on reply, no reopening closed sessions (409), events logged.

**Updated:**
- `llm-runtime.ts` prompt: company facts come only from the knowledge base, customer-given details may be repeated back, memory privacy rules.
- `ticket-workflow.ts`: AI reply extracted and shared, with thread history and memory.
- Manual tickets link to the requester's Contact.
- `.env.example`: `ASSISTDESK_DEFAULT_COUNTRY_CODE`, cron jobs.

**Notes / follow-ups:**
- Voice channel (M3).
- Redis or `LISTEN/NOTIFY` for multi-instance push.
- Email OTP to verify web identities.
- "Hide anonymous visitors" filter on Contacts.
- Role check on memory edits.
- Concurrency of the email retry was verified only sequentially: the PGlite test database cannot run parallel connections.
- On the free LLM tier, heavy test bursts exhaust the per-minute quota, and replies then fall back to the knowledge-base answer.

---

## 2026-09-29 — Module 7 (User Dashboard) and Module 10 (Knowledge Base) completed
**Modules:** M7 + M10 (bonus: M11 FE-3/FE-4 RBAC, all 4 Critical security issues)   **Author:** Claude (with Muhammad Awais)
**Result:** M7 ≈ 75% → ≈ 90%, M10 ≈ 70% → ≈ 90%. Every proposal feature of both modules is implemented; M10 uses Pinecone once a key is added.

**Database: migration `20260929090000_module7_module10`:**
- New `Notification` model (dashboard alerts, per-user read state) and `PromptTemplate` model (SRS FR-9).
- `User.mustChangePassword`; `TicketMessage.authorName`.
- Embedding tracking: `KnowledgeSource.embeddingModel` / `vectorStore` and `KnowledgeChunk.embeddingModel`.
- Existing sessions are cleared, because session tokens are now stored hashed.

**Module 10: Knowledge Base:**
- **FE-1, real vector storage:**
  - Real embeddings via OpenRouter (`openai/text-embedding-3-small`, using the existing key), with Google or OpenAI as alternatives.
  - An offline keyword model is used if the provider is down; the source is flagged "keyword search only" and an alert is raised.
  - **Pinecone** vectors (one namespace per workspace, SRS SEC-4) switch on automatically when `PINECONE_API_KEY` and `PINECONE_INDEX` are set. Otherwise vectors are stored in PostgreSQL.
- **FE-2, better retrieval:**
  - Section-aware chunking: a heading always starts a new chunk; chunks are ~1000 characters with overlap.
  - Hybrid search: 85% semantic + 15% keyword, with a Unicode tokenizer that handles Urdu and accents.
  - The AI now sees the top 5 **full** chunks, instead of 3 excerpts of 360 characters.
  - The agent's **confidence threshold** now decides which passages may ground an answer (SRS FR-8.5). Off-topic questions get "I don't have that information" plus a handoff offer.
  - Verified with paraphrases that share no keywords with the source ("money back" → Refund Policy, "sole came off" → Warranty, "open on Sunday" → Support hours).
- **FE-3/FE-5, UI:**
  - One Re-sync action; search, filters, sorting and pagination.
  - Search-mode column (Semantic · Pinecone/PostgreSQL / Keyword); "Re-index all"; a real "Test URL" check.
  - Detail page with metadata, a paginated chunk list and a **Test retrieval** box showing overall, semantic and keyword score bars.
  - Deleting a source purges its vectors.
- **FE-4, durable indexing:** sources start PENDING; jobs run after the response (`after()`). Stuck or legacy sources are re-queued when the knowledge-base page loads and by `/api/cron/knowledge` (`CRON_SECRET`). Chunks are replaced atomically.

**Module 7: User Dashboard:**
- **FE-3, alerts:**
  - New **Overview** home page (`/dashboard`) with real KPIs for 7 or 30 days: AI replies, average response time, fallback rate, tokens, open tickets, active and waiting chats, team online, and a per-agent performance table.
  - Knowledge health and recent alerts.
  - **Notifications bell** with an unread badge and mark-as-read, raised for:
    - new chats and chats waiting for a human;
    - new email tickets and low-confidence AI answers;
    - knowledge sync failures and keyword-only indexing;
    - integration errors and failed Slack/WhatsApp/email deliveries;
    - team invites.
- **Tickets (SRS FR-5):**
  - Server-side pagination, sorting and filtering (fixes the "only 50 oldest tickets" bug), and filter chips that work.
  - Real checkboxes with **bulk actions** (status, priority, assign, tag, delete).
  - Timeline shows the real author; internal notes no longer reopen tickets or overwrite the preview.
  - Serialized sidebar edits; a working Markdown toolbar and variables menu.
  - A single canned-response variable set (old spellings still work).
- **Prompts page (SRS FR-9.1–9.6):** CRUD, search, variable chips, live preview, 3 default templates, and "Use prompt template" in ticket AI drafts. Internal notes are excluded from AI drafts.
- **Reports:** only real numbers now (first-response time, resolution time, AI-resolved rate, per-channel figures, AI latency and fallback); the invented metrics are removed.
- **Users:**
  - Search, filters and pagination; only allowed actions are shown.
  - Invites return a **one-time temporary password** and force a password change at first sign-in.
- **Profile and Settings (FE-5):**
  - Change password (signs out other devices).
  - Workspace info and role description; timezone select.
  - Settings are read-only below Admin; the fake theme switch is removed.
- **Shell:**
  - Mobile top bar and off-canvas menu (SRS UI-2).
  - Nested-route highlighting and SVG icons.
  - `loading.tsx`, `error.tsx` and `not-found.tsx`.
  - Temporary-password banner.
  - Login no longer shows demo credentials; signup validates inline and has a confirm-password field.

**Security (all 4 Critical items closed):**
- **SEC-01:** bcrypt password hashing, with automatic upgrade of old SHA-256 hashes. The plaintext/hash-as-password comparison is gone, and password hashes are never selected (global Prisma omit plus narrowed ticket queries).
- **SEC-02:** demo `admin/admin` seeding is removed. The dev-only demo needs `ASSISTDESK_SEED_DEMO=true` and `ASSISTDESK_DEMO_PASSWORD`.
- **SEC-03:** the email webhook **requires** its secret.
- **SEC-04:** **RBAC enforced** on 17 route files: Admin for team, settings, integrations and inboxes; Manager for AI, knowledge, prompts and deletions. Nobody can change the Owner or their own role.
- **SEC-05/13:** login rate limit (5 attempts per 10 minutes), hashed session tokens, `secure` cookie in production.
- **SEC-06:** random temporary passwords for invites.

**Tooling:**
- ESLint now really lints: it extends `next/core-web-vitals` and `next/typescript`; 0 errors.
- `npm install` works without `--legacy-peer-deps`: unused `@langchain/pinecone` removed, `@types/node` bumped to 24.
- Added `bcryptjs`.

**Files:**
- New libs: `src/lib/` `embeddings.ts`, `vector-store.ts`, `knowledge-chunking.ts`, `notifications.ts`, `rbac.ts`, `prompt-templates.ts`, `canned-variables.ts`, `form-validation.ts`.
- Rewritten libs: `src/lib/auth.ts`, `src/lib/knowledge-indexing.ts`.
- Updated libs: `knowledge-runtime.ts`, `llm-runtime.ts`, `prisma.ts`, `demo-data.ts`, `mailer.ts`, `ticket-workflow.ts`, `email-ingestion.ts`, `setup.ts`, `integrations/channel-inbound.ts`.
- New API routes:
  - `app/api/notifications`, `app/api/profile/password`
  - `app/api/prompts` (+ `[id]`), `app/api/tickets/bulk`
  - `app/api/knowledge-sources/{search,reindex,test-url}`, `app/api/cron/knowledge`
- Updated API routes: auth (login, signup, logout), users, profile, tickets (list, `[id]`, messages, draft), canned responses, tags, email inbound, plus role checks on settings, integrations, inboxes, AI agents, chatbots, knowledge sources and uploads.
- UI:
  - New: `app/dashboard/page.tsx` (Overview) plus its loading, error and not-found pages; `overview-workspace.tsx`, `notifications-bell.tsx`, `prompts-workspace.tsx` with its page.
  - Updated: sidebar and config, layout, settings, profile, login, signup, landing, tickets list and detail, canned responses, reports, users, logs, tags, knowledge-base list and detail, the agent Sources tab, and the setup wizard (now ends on Overview).
- Tests: `tests/unit/auth-and-rbac.test.ts`, `tests/unit/knowledge-retrieval.test.ts` (47 unit tests in total). Also `eslint.config.mjs`, `package.json`.

**Verified:**
- `tsc` clean; 47/47 tests; `eslint .` 0 errors; `next build` OK (50 pages).
- End-to-end on a fresh temporary database:
  - **Auth:** signup validation, invite, and the forced password change.
  - **Roles:** the Agent role is refused on settings, invites, agent delete and ticket delete (single and bulk), but can change status.
  - **Security:** the login lockout returns 429 after 5 failures, the email webhook refuses a missing or wrong secret, and ticket responses contain no secrets.
  - **Knowledge base:** real embeddings (SYNCED, `openrouter:openai/text-embedding-3-small`) and semantic retrieval with paraphrases.
  - **Answers:** grounded answers, the off-topic refusal, and the widget answer from the knowledge base.
  - **Tickets:** pagination and page 2, search by number, priority filter, and the bulk update through the UI.
  - **Overview and prompts:** the Overview KPIs and alerts update, and the prompt-template draft uses customer name plus warranty knowledge.

**Found and fixed during testing:**
- The chunker attached headings to the wrong section and merged sections.
- The semantic score calibration was too strict for `text-embedding-3-small`.
- Setup finished on Tickets instead of Overview.
- The dev Prisma client cache check was missing the new models.
- ESLint was scanning the Chrome profile folders.

**Notes / follow-ups:**
- Add `PINECONE_API_KEY` + `PINECONE_INDEX` (dimension 1536, cosine) to use Pinecone, then click "Re-index all".
- Add a Groq key (AI-10): the free OpenRouter models fail intermittently, and the fallback then answers from the knowledge base.
- Set `CRON_SECRET` and schedule `/api/cron/knowledge`.
- Run `npx prisma migrate deploy`. Everyone signs in again once, because of hashed sessions.
- New issues: SEC-30, BUG-26, BUG-27, AI-11.

---

## 2026-09-28 — Module 1 completed (Assistant Creation & Omnichannel Integration)
**Module:** M1 (with small groundwork for M5/M9/M6)   **Roadmap phase:** Module 1   **Author:** Claude (with Muhammad Awais)
**Result:** M1 ≈ 65% → ≈ 92%. All five proposal features (FE-1 … FE-5) are implemented; live Slack/WhatsApp/SMTP tests need real accounts.

**Database — migration `20260928120000_module1_complete`:**
- AIAgent: `tone`, `responseLength`, `maxTokens`. Chatbot: `avatarUrl`, `conversationStarters`, `fallbackDelaySeconds`; `Chatbot → AIAgent` changed from Cascade to **Restrict**.
- KnowledgeSource: `crawlMode`, `maxPages`, `pageCount`. Inbox: `senderName`, `smtpHost/Port/User/Password/Secure`.
- ChatSession: `integrationId`, `externalId`. ChatMessage: `attachments`, `authorName`, `externalId` (unique, used for dedupe).
- Integration: `externalId` (unique per type), `statusMessage`. User: `lastSeenAt`. TicketMessage: `deliveryStatus`, `deliveryError`.
- Data fix: keyless "Groq" agents moved to the managed Default provider.

**Added:**
- **FE-1 appearance and conversation flows**
  - Bot avatar upload (Cloudinary if configured, otherwise local storage); up to 4 conversation-starter chips.
  - The launcher button takes the brand colour and avatar.
  - Markdown replies in the widget; the live preview uses real settings (no fake messages).
- **FE-2 training data**
  - PDF (unpdf) and Word .docx (mammoth) extraction, with a 10 MB limit and a file-type allow-list.
  - Drag-and-drop upload.
  - **Website crawling:** single page, or same-site crawl of up to 25 pages via sitemap and links. It uses Firecrawl when `FIRECRAWL_API_KEY` is set, otherwise a built-in crawler.
  - URL re-sync now fetches the page again.
- **FE-3 channels**
  - **Slack:** Events API, signature verification, DMs and @mentions, threaded replies.
  - **WhatsApp:** Cloud API webhook verify, X-Hub-Signature-256, text replies.
  - Both test their credentials on save (real CONNECTED/ERROR status), encrypt tokens, show step-by-step setup guides, and dedupe retried events.
  - Integrations page: Web Widget row and per-channel on/off toggles.
  - Outbound email for ticket replies and confident AI replies. It uses the inbox's own SMTP (verified on save) or the platform SMTP from `.env`, and shows the delivery status on the ticket.
- **FE-4 behaviour**
  - Tone (Friendly / Professional / Casual / Empathetic / Direct), response length (Short / Balanced / Detailed), and a max-reply-tokens setting.
  - The agent's temperature and token limit are now honoured.
  - **Reply modes work:** Always; Operator offline (based on dashboard presence); Fallback (the AI answers if no human replies within N seconds).
- **FE-5 deploy**
  - Publish / Unpublish (only Live agents answer on channels).
  - Real online/offline status.
  - Pause/resume takes effect immediately; "Test widget" button.
  - Deleting an agent that powers chatbots is blocked with a clear message.
- **Widget:**
  - file and image attachments, an emoji picker, voice typing (Web Speech API);
  - an inline contact card with email and phone validation;
  - a typing indicator, polling every 4 s for new messages, and a "Powered by AssistDesk AI" footer.
- **Chats (dashboard):**
  - team members can reply;
  - Take over (the AI pauses), Hand back to AI, Close and Reopen;
  - live refresh, a mobile layout, and a presence heartbeat.
- **Playground:** conversation history, Markdown, the model and latency per reply, a warning when the knowledge-base fallback answered, and a double-send guard.
- **Tests:** Vitest set up (`npm test`), 31 unit tests covering:
  - encryption, widget tokens and domain matching;
  - SSRF blocking;
  - Slack and WhatsApp signatures and parsing;
  - PDF, DOCX and HTML extraction and the crawler scope;
  - agent and integration config;
  - the LLM reply sanity check.
- `.env.example` documenting every environment variable.

**Fixed:**
- SEC-07: domain allow-list. The iframe Referer is checked, a signed embed token is issued, and the check fails closed.
- SEC-09: SSRF guard with a public-IP check, redirect re-validation and a size cap.
- SEC-10 and SEC-25: provider keys encrypted with AES-256-GCM and never sent to the browser (masked preview only); a blank field on edit keeps the stored key.
- SEC-15, SEC-20, SEC-22, SEC-24, SEC-26.
- BUG-04, BUG-10, BUG-12, BUG-13, BUG-21, BUG-22, BUG-23, BUG-24.
- AI-03: timeouts, logged errors, and managed failover Groq → Gemini → OpenRouter.
- AI-05, AI-06, AI-09.
- DATA-02.
- UI-05, UI-08, UI-12 – UI-17, UI-26 – UI-29.
- DOC-04, OPS-06.

The partial fixes are listed in the VULNERABILITIES.md status log.

**Also fixed during testing:**
- Crawler links containing `#` were skipped.
- The widget treated a `localhost:<other port>` site as the dashboard.
- OpenRouter's retired free models were replaced, and moderation-model replies are rejected.
- Focus returns to the message box after picking an emoji.

**Files:**
- New libs:
  - `src/lib/`: `secrets.ts`, `safe-fetch.ts`, `html-text.ts`, `web-crawler.ts`, `document-extract.ts`, `knowledge-file-types.ts`, `widget-token.ts`, `widget-constants.ts`, `presence.ts`, `uploads.ts`, `conversation-runtime.ts`, `mailer.ts`, `agent-serializer.ts`
  - `src/lib/integrations/`: `slack.ts`, `whatsapp.ts`, `config.ts`, `serialize.ts`, `channel-inbound.ts`, `channel-outbound.ts`
- New routes:
  - `app/api/integrations/slack/events/[integrationId]`, `app/api/integrations/whatsapp/webhook/[integrationId]`
  - `app/api/chat-sessions/[id]` (+ `/messages`), `app/api/presence`, `app/api/uploads/avatar`, `app/api/uploads/[folder]/[file]`, `app/api/widget/[widgetId]/attachments`
- Rewritten:
  - `src/lib/llm-runtime.ts`, `src/lib/chatbot-widget.ts`
  - `app/widget/[widgetId]/page.tsx`, `app/api/widget/[widgetId]/route.ts`, `app/api/widget/[widgetId]/messages/route.ts`
  - `app/api/ai-agents/route.ts`, `app/api/integrations/route.ts`
  - `src/components/widget/chatbot-widget-client.tsx`, `public/assistdesk-widget.js`
- Updated:
  - `prisma/schema.prisma`, `src/lib/prisma.ts` (global omit of secrets)
  - `src/lib/agent-config.ts`, `src/lib/knowledge-indexing.ts`, `src/lib/knowledge-runtime.ts`, `src/lib/ticket-workflow.ts`, `src/lib/setup.ts`, `src/lib/demo-data.ts`, `src/lib/chatbot-config.ts`
  - API routes for chatbots, inboxes, knowledge sources, the ticket draft/messages, integrations `[id]` and `ai-agents/[id]`
  - UI components: agents, agent configuration, chatbots, chatbot configuration, the widget preview, chats, integrations, the inbox editor, the knowledge base, ticket detail, and the new `presence-heartbeat.tsx`
  - their `app/dashboard/**` pages and `layout.tsx`
- Config: `package.json` (+unpdf, mammoth, nodemailer, react-markdown, vitest, vite, @types/nodemailer; `test` script), `vitest.config.mts`, `tests/unit/*`, `tests/fixtures/*`, `.gitignore`, `.env.example`.

**Verified:**
- `tsc` clean; 31/31 tests; Next lint rules 0 errors; `next build` OK.
- End-to-end on a temporary database:
  - signup and the setup wizard;
  - Playground with memory;
  - the widget embedded on a separate origin (allowed and blocked domains, email card, emoji, attachments);
  - Fallback mode, human reply, takeover and hand-back;
  - avatar upload, starters, pause;
  - PDF, DOCX and a 3-page crawl, with answers from them;
  - signed and forged Slack/WhatsApp webhooks, and dedupe;
  - SMTP verification, and a real email captured by a local SMTP server.

**Notes / follow-ups:**
- Set `ASSISTDESK_ENCRYPTION_KEY` (required in production). Add a free Groq key for faster answers (AI-10).
- Run `npx prisma migrate deploy` on your database.
- Live Slack/WhatsApp tests need a Slack app, a Meta developer app and a public URL (e.g. `ngrok http 3000`).
- ESLint config lints nothing (OPS-04). Installs need `--legacy-peer-deps` (OPS-07).
- Nothing committed (per request).

---

## 2026-09-28 — Baseline audit & 60% roadmap (no code changes)
**Module:** All (planning)   **Roadmap phase:** P0   **Author:** Claude (with Muhammad Awais)
**Files:**
- ROADMAP.md (new)
- VULNERABILITIES.md (new)
- CHANGELOG.md (new)

**Added:**
- Full audit of the 30% codebase against the Proposal, SRS (FR-1 … FR-17, NFRs) and SDS Chapter 3–5.
- Module-by-module completion estimate, chosen modules for the 60% milestone, and a dated plan up to the 15 Oct 2026 deadline.
- Vulnerability / issue register (security, bugs, data, UI, docs mismatch). Nothing was fixed yet — list only.

**State of the repo at audit time:**
- `main` is level with `origin/main` (last commit `4a11868 "updated"`, 2026-05-11).
- ~21 files of **uncommitted** chatbot-widget runtime work (widget API, `/widget/[widgetId]` page, `public/assistdesk-widget.js`, migration `20260511073000_add_chatbot_widget_runtime`). Commit this first (roadmap P0).
- `tsc --noEmit` passes, `eslint` passes.
- No PostgreSQL is installed/running on this machine, so the app could not be exercised end-to-end during the audit.
