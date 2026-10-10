# AssistDesk: Verification Report (60% milestone)

**Date:** 10 Oct 2026 · **Branch:** `awais` @ `5b5921d` + fixes from this pass · **Prepared by:** Claude (with Muhammad Awais)
**Question answered:** Does the code really do what the Proposal, SRS and SDS promise, and what our own progress documents (ROADMAP, CHANGELOG, module docs) claim?

---

## 1. Summary

| | Result |
|---|---|
| Automated tests | **All green:**<br>• Typecheck: 0 errors<br>• Lint: 0 errors, 4 warnings (all from before this pass)<br>• Unit tests: **139/139**<br>• Integration tests on a real database: **43/43**, plus 1 opt-in real-model test<br>• Production build: passes<br>• A fresh database built from all 18 migrations has **no drift** against `schema.prisma`. |
| Requirement coverage | 7 modules are well implemented: M1, M7, M10, M5, M8, M4, M2. Every Proposal feature (FE) of these modules exists in code. Some finer SRS requirements (FR-level details, NFR timings, named technologies) are missing or done differently; all are listed below. |
| Honest completion | **≈ 63% overall** (the ROADMAP said ≈ 66%). Every module was re-scored at FR level, not just FE level. **The 60% target is still met.** |
| Bugs found | **1 real bug, fixed in this pass:** the reasoning engine dropped tool calls beyond the 4th in a step without answering them, which breaks OpenAI-compatible APIs (§5.1). Plus 5 configuration options that do nothing (§5.2). |
| Document accuracy | Our progress docs were **mostly accurate** but had **15 stale or overstated statements**, now corrected (§6). The **SDS is out of date**: it describes the 30% system, with 17 of the 36 data models and no diagrams for M2/M4/M5/M8 (§8). |
| Runtime end-to-end run | **131/131 passed** (`scripts/e2e/e2e-all.mjs`, every module against the live app, with real AI answers from the knowledge base) (§3.3). The Module 2 booking flow passed 16/16 with a real model on 6 Oct. Its re-run today was blocked by the free AI quota, not by a defect (§3.4). |

---

## 2. How this was verified

1. **Documents:** text was extracted from the SRS (`AssistDesk - SRS Document.docx`), the Proposal (`AssistDesk.docx`) and the SDS (`AssistDesk_Chapter3_SDS final.docx` plus `docs/*.md`). Every module feature (FE), functional requirement (FR, from mock-ups M-1…M-17), use-case event, non-functional requirement (REL/USE/PER/SEC), interface (CI/SI) and constraint (CON) was listed.
2. **Code review against requirements:** four reviewers each took one area (M1+M7, M10+M5, M8+M4, M2 + NFRs + SDS). Each requirement was checked in the code and cited by file and line. Each claim in ROADMAP, CHANGELOG and the four module docs was checked too. The most serious findings were re-checked by hand before being reported.
3. **Automated tests from a clean start:** a brand-new database, all migrations, a schema-drift check, typecheck, lint, unit tests, integration tests and a production build.
4. **Runtime end-to-end:** `scripts/e2e/e2e-all.mjs` was run against the dev server on the fresh database, with real AI calls (see §3.3).

Status legend: ✅ implemented · 🟡 partly · ❌ missing · ⚠️ implemented differently.

---

## 3. Test results

### 3.1 Automated suites (10 Oct 2026, fresh database)

| Check | Result | Notes |
|---|---|---|
| `prisma migrate deploy` on an empty database | ✅ 18/18 migrations | — |
| Schema drift (migrations vs `schema.prisma`) | ✅ none | `prisma migrate diff` produces an empty migration. |
| TypeScript `tsc --noEmit` | ✅ 0 errors | — |
| ESLint (Next rules) | ✅ 0 errors, 4 warnings | `<img>` hints and one aria warning, in files untouched since M1. |
| Unit tests (`npm test`) | ✅ **139/139** in 12 files | Auth and RBAC, secrets, SSRF guard, knowledge ingestion and retrieval, sessions and memory, widget security, channel signatures, leads, analytics, tools. |
| Integration tests (`npm run test:integration`, real PostgreSQL via PGlite) | ✅ **43/43** + 1 skipped | Tool registry and built-ins (14), LangGraph engine (12, including the new §5.1 test), admin APIs with RBAC (11), action logs (6). The skipped test is the opt-in real-model test. |
| Production build (`next build`) | ✅ passes | Run 9 Oct with Node memory capped at 3 GB; all 60+ routes compiled. |

### 3.2 Earlier end-to-end runs (real dev server and a real AI model)

| Module | Date | Result | What it covered |
|---|---|---|---|
| M2 Agentic tools | 6 Oct | **16/16** | Order tracking forced by an intent rule; booking held until the customer said yes, then booked once with the real email; action logs API. |
| M2 browser checks | 4–6 Oct | ✅ | Tools page and template, Test runner, agent Actions tab with rule preview, Appointments booking, Logs → AI actions timeline, Playground reasoning view, Chats panel, Reports section. |
| M5, M8, M4 | 29–30 Sep | ✅ (as recorded in CHANGELOG) | The scripts were in a temporary folder and have since been deleted, so **these numbers can't be reproduced from the repo** (see recommendation R3). |

### 3.3 Full end-to-end run: 131/131

`scripts/e2e/e2e-all.mjs` was written for this pass and is now in the repo with a README. It drives the real app over HTTP:

- **Accounts:** signup, login, password change, invites, Agent-role 403s on 5 protected APIs.
- **M1:** agent, chatbot, embed token for allowed and refused sites, inbox, prompts, canned replies, tags.
- **M10:** text source → chunked and embedded → retrieval finds the passage; SSRF block.
- **M7:** ticket lifecycle; internal note keeps the customer's issue; bulk actions; inbound email and threading; delete.
- **M5:** widget chat answered from the knowledge base; hashed token; history; SSE stream; takeover with the AI paused; agent reply seen by the visitor; transcript; end chat and the linked new session; contact memory; cross-workspace 404; 429 rate limit; cron secret.
- **M8:** lead form pauses the AI; validation; capture; list, status, notes and CSV; webhooks with HMAC verified.
- **M4:** analytics, live, reports, improvements, export and its role check.
- **Pages:** all 27 dashboard pages render.

**Result (10 Oct, fresh database, real AI model): 131/131 passed.**

The first run was postponed while the PC was low on memory. Runs 1–3 then exposed only problems in the **new script itself**, all corrected:
- wrong embed-script path (`/assistdesk-widget.js`);
- partial chatbot saves (the API saves the whole configuration, as the dashboard does);
- a regex that missed the model's non-breaking hyphen in "3‑year";
- a response truncated before the transcript text;
- email threading tested with `In-Reply-To` instead of the `[PREFIX-NUMBER]` subject reference the app uses;
- the lead note field name;
- a signature check that picked up a delivery from an earlier run's endpoint;
- Next.js's built-in 404 component in every page's script data mistaken for an error;
- a 4 s timeout shorter than dev-mode route compilation (11.5 s measured).

**No application defect was found in the end-to-end run.** Highlights the run confirmed:

| Area | Confirmed on the live app |
|---|---|
| Security | bcrypt password hashes; hashed session and widget tokens; hashed client IPs; Agent role refused on 5 admin APIs (403); anonymous refused (401); widget refused for a site that is not allowed; widget API refused without the embed token; inbound email with a wrong secret refused (401); cross-workspace contact → 404; SSRF block on URL sources; webhook HMAC verified **and a tampered body rejected**. |
| AI quality | Widget answer grounded in a just-added knowledge source ("3‑year warranty"); follow-up answered in context ("45 days"); AiInteraction recorded as grounded. |
| Sessions | Takeover pauses the AI; the visitor sees the agent's reply; end chat → CLOSED; next message starts a new linked session; 429 with Retry-After after 3 messages/min; cron needs `CRON_SECRET`. |
| Leads | Form pauses the AI; field validation; capture with score and contact link; status change and note; CSV; webhooks for create and update. |
| UI | All 27 dashboard pages render for an admin; anonymous users are redirected to sign in (307). |

### 3.4 Module 2 re-run on the fresh database

`scripts/e2e/setup-m2.mjs` (actions on, Track order tool, intent rule) followed by `e2e-m2.mjs`:

- **Run A: 12/16.**
  - Order tracking passed: the intent rule forced a real `track_order` call, the reply used the order facts, the chain of thought was stored, and the action logs API returned it.
  - The booking checks failed because the script asked for "tomorrow" = **Sunday**. Booking hours are Mon–Fri, and the AI **correctly** said there were no openings. The script now picks the next weekday.
- **Run B: 9/16.** The **free OpenRouter quota for the day was exhausted** (`429 free-models-per-day`, 50 requests). The app degraded as designed: it fell back to the knowledge-base answer and recorded every model failure in the run's trace.
- The booking-with-confirmation flow last passed 16/16 on 6 Oct. Re-run it after the quota resets, or with a Groq key (R5).

---

## 4. Requirement coverage by module

Each module's ROADMAP figure counts Proposal features (FE) only. The **verified** figure also counts the SRS functional requirements on the same screens and named technologies.

| Module | ROADMAP claim | Verified | Verdict |
|---|---|---|---|
| M1 Assistant creation & omnichannel | 92% | **≈ 80%** | Core works end to end. Gaps: no voice; Slack/WhatsApp/SMTP never tested with real accounts (Slack uses a pasted token, not OAuth; WhatsApp has no media); a few settings do nothing (§5.2). |
| M7 User dashboard | 90% | **≈ 85%** | All 5 FEs are real. Missing FR details: agent attachments and emoji in Chats, presence dot, inbox auto-reply template, unsaved-changes prompt; the API Keys page is a placeholder. |
| M10 Knowledge base | 90% | **≈ 78%** | The ingest → chunk → embed → retrieve pipeline is real. Pinecone and Firecrawl are coded but **not configured**, so vectors live in Postgres. No bulk select, no `.doc`, no upload progress bar. |
| M5 Context & sessions | 90% | **≈ 80%** | The lifecycle, 3-layer memory, contact merge and rate limiter match the M5 doc. No voice, SSE instead of WebSockets, no token streaming, and the cron job is not scheduled. |
| M8 Lead generation | 92% | **≈ 88%** | All 5 FEs plus HMAC webhooks. No API-key access for external systems; automatic webhook retries need a scheduler. |
| M4 Monitoring & analytics | 90% | **≈ 84%** | All 5 FEs and FR-11.1–11.7 run on real data. Some SRS definitions are implemented differently (§4.6). |
| M2 Agentic tools | 90% | **≈ 88%** | All FEs, LangGraph, confirmation, action logs. Order tracking and invoices are HTTP templates against a demo store, not built-ins. No refund or payment tool. |
| M6 LLM management (bonus) | 35% | ≈ 37% | Multi-provider support, fallback chain, retired-model memory, feedback loop. No streaming or voice. |
| M9 Escalation (bonus) | 15% | **≈ 32%** (understated) | Human takeover, plus the AI `escalate_to_human` action and auto hand-over on failure. Escalation reasons appear in analytics. |
| M11 Integrations & RBAC (bonus) | 45% | ≈ 45% | RBAC with 4 roles, channels, signed webhooks. No audit log, no API keys. |
| M3 Subscription & payment | 0% | 0% | Stripe is installed but unused. |
| **Overall (equal weights)** | **≈ 66%** | **≈ 63%** | Above the 60% target. |

### 4.1 M1: Assistant creation & omnichannel (≈ 80%)

| Ref | Requirement | Status | Evidence / gap |
|---|---|---|---|
| FE-1 | Configure appearance, personality, conversation flows | 🟡 | Avatar, colour, position, starters and tone are done. Two of the seven listed automations ("AI Follow-up", "Close Ticket") have no code that runs them (§5.2). |
| FE-2 | Training from documents, crawl, text | ✅ | PDF/DOCX/TXT/MD/CSV up to 10 MB; sitemap crawl. Legacy `.doc` is not accepted. |
| FE-3 | Website, WhatsApp, Slack, other channels | 🟡 | All four channels are coded (widget, WhatsApp, Slack, email). Slack, WhatsApp and SMTP have never run with real accounts. Slack uses a pasted bot token (FR-16.5 asks for OAuth). WhatsApp handles text and buttons only. |
| FE-4 | Greeting, tone, response patterns | ✅ | Welcome message, tone, length, reply modes. |
| FE-5 | Deploy instantly | ✅ | Publish/unpublish, embed snippet. |
| FR-2.x / 3.x / 4.x | Setup wizard | ✅ / ⚠️ | 4 steps instead of 3. The training step can be skipped (FR-3.6 says it is required). Prefix availability is checked on click, not live. |
| FR-7.x | Agents page | ✅ | — |
| FR-8.1 | Edit agent in a side drawer | ⚠️ | Edit opens a full page with tabs. |
| FR-8.2–8.9 | Agent settings | ✅ | The confidence slider starts at 0.1. |
| FR-12.x / 13.x / 14.x | Chatbots page, config, AI settings | ✅ | Exceptions: the FR-13.8 "Email notifications" toggle does nothing (§5.2), and FR-14.8 "empty = unlimited" is not possible (range 1–1000). |
| FR-16.1–16.7 | Integrations page | ✅ / ❌ | FR-16.5 Slack OAuth ⚠️; FR-16.6 voice ❌. |
| FR-17.x | Widget | ✅ / 🟡 | Header dot is green when the AI is live (the SRS means humans online); single tick, no read receipts; AI and human bubbles share a style; "voice" is browser dictation. |
| Backend | Agent delete rules (block if in use, soft delete, log) | 🟡 | Blocks only when chatbots use the agent; hard delete; not logged. |

### 4.2 M7: User dashboard (≈ 85%)

| Ref | Requirement | Status | Evidence / gap |
|---|---|---|---|
| FE-1…FE-5 | Central dashboard, KB management, notifications, playground, profile/organisation | ✅ | No user avatar upload. |
| FR-5.x | Tickets list, search, filters, bulk, pagination | ✅ | There is no separate advanced-filter panel (FR-5.4). |
| FR-6.1 / 6.2 | Chat list avatar; customer presence dot | 🟡 / ❌ | — |
| FR-6.6 / 6.7 | Agent attachments and emoji in Chats | ❌ | Admitted in ROADMAP. |
| FR-6.8 | System Bot entries | ⚠️ | Shown inside the thread. |
| FR-9.x | Prompt templates | ✅ | Used for ticket AI drafts only. |
| FR-15.1 | Unsaved-changes prompt | ❌ | — |
| FR-15.5 | Auto-reply canned template | ❌ | The field is stored; there is no UI and no sending. |
| — | API Keys page | ❌ | Placeholder page (M11). |

### 4.3 M10: Knowledge base (≈ 78%)

| Ref | Requirement | Status | Evidence / gap |
|---|---|---|---|
| FE-1 / CON / OE-3 | Vector DB (Pinecone) | ⚠️ | Pinecone code exists (namespace per workspace) but **no key is configured**. Vectors are stored as JSON in Postgres and scored by cosine in code. No pgvector index. |
| FE-2 | KB search to answer | ✅ | Hybrid retrieval (semantic + keyword, top-5) with a confidence threshold. |
| FE-3 | Add / update / delete | ✅ | Delete is a hard delete with no log (the SDS state diagram has a DELETED state). |
| FE-4 | Automatic indexing | ✅ | `after()` queue plus a recovery sweep. The cron route is not scheduled. |
| FE-5 | Real-time updates | ✅ | — |
| FR-10.1 | KB under the AI section of the sidebar | ⚠️ | It is under **Setup**. |
| FR-10.2 | Drag-and-drop; PDF/CSV/DOC/TXT; progress | 🟡 | No `.doc`; "Uploading…" text instead of a progress bar; files stored on local disk (Cloudinary only for avatars). |
| FR-10.3 | URL crawl via Firecrawl | 🟡 | Firecrawl is not configured, so the built-in crawler runs. |
| FR-10.6 | Table with **bulk checkboxes** | 🟡 | No bulk selection. |
| FR-10.4/10.5/10.7, SEC-4, UI-4 | Add button, search/filter, row menu, tenant isolation, pagination | ✅ | — |

### 4.4 M5: Real-time context & sessions (≈ 80%)

| Ref | Requirement | Status | Evidence / gap |
|---|---|---|---|
| FE-1 / FE-3 / FE-4 | Sessions, context, history | ✅ | Hashed tokens; 12-message window plus rolling summary plus customer profile; SessionEvent history. |
| FE-2 | Cross-platform sync (SRS example: WhatsApp → voice) | ⚠️ | Web, WhatsApp, Slack and email share one Contact. **No voice.** Documented in the M5 doc. |
| FE-5 | Expiry policies | ✅ | Lazy expiry on use plus a cron route. Nothing schedules the cron (no `vercel.json`) and `CRON_SECRET` is empty in `.env`. The email and voice policy constants are never used. |
| FE-6 | Rate limiting | ⚠️ | Postgres instead of Redis (documented); 429 with Retry-After; logged. The Playground is not rate-limited. |
| SRS event | WebSocket messages and streamed tokens | ⚠️ | SSE plus HTTP (documented). **Replies are not streamed token by token** (not documented before). |
| SRS event | Unauthorized widget origin → 403 **and logged** | 🟡 | The 403 works; the attempt is not logged. |
| PER-3 | Context sync ≤ 1 s | 🟡 | SSE on one instance; 2 s database poll across instances. |

### 4.5 M8: Lead generation (≈ 88%)

| Ref | Requirement | Status | Evidence / gap |
|---|---|---|---|
| FE-1 | Custom lead forms in conversation | ✅ | Builder (up to 8 fields, 3 triggers), inline widget card, the AI pauses. Web widget only. |
| FE-2 | Auto-collect contact details | ✅ | Typed details, WhatsApp/Slack intent, and the AI `capture_lead` action (M2). |
| FE-3 | Notify external channels | ✅ | Dashboard, email (needs SMTP), Slack. |
| FE-4 | Export or forward via webhooks **or APIs** | 🟡 | Webhooks and CSV. There is no API-key access for external systems (M11). |
| FE-5 | Lead database | ✅ | — |
| CI-3 | Signed webhooks, retries | ✅ | HMAC-SHA256, 4 attempts (30 s / 2 min / 10 min). **Retries run only when the cron route is called**, and nothing schedules it. |
| FR-17.5 | Inline email card | ✅ | Validated after submit, not as the user types. |
| USE-2 | Inline validation ≤ 500 ms | 🟡 | Server-side only. |

### 4.6 M4: Monitoring & analytics (≈ 84%)

| Ref | Requirement | Status | Evidence / gap |
|---|---|---|---|
| FE-1…FE-5 | Tracking, transcripts, dashboard, reports, improvement areas | ✅ | All on real data (`AiInteraction`). |
| FR-11.1 | Avg response time with interval refresh | 🟡 | Refreshes on load or filter change; only Live Sessions polls (15 s). |
| FR-11.2 | Automation rate | ⚠️ | The denominator is *finished* conversations (documented). |
| FR-11.3 | Leads captured (widget submissions) | ⚠️ | Counts every lead source (form, auto, AI, manual). Now documented. |
| FR-11.4 | Live sessions | ✅ | 15 s polling. |
| FR-11.5 | 24 h latency chart | ⚠️ | Rolling last 24 h, not a fixed day; ignores the date filter (the UI says so). |
| FR-11.6 / 11.7 | Recent interactions, channel icons | ✅ | — |
| UC | Latency from receipt to dispatch; record written on session close | ⚠️ | Generation time only; derived at query time. Documented in the M4 doc §8. |
| PER-2 | Pages ≤ 2 s | ❓ | Not measured; aggregates raw rows (OPS-11). |

### 4.7 M2: Agentic tools (≈ 88%)

| Ref | Requirement | Status | Evidence / gap |
|---|---|---|---|
| FE-1 | Appointment booking, order tracking, invoices, customer info | ⚠️ | Booking and customer info are built in. Order tracking and invoices are **HTTP tool templates** against the demo store; locally they need `ASSISTDESK_ALLOW_PRIVATE_TOOLS=true`. |
| FE-2 / CON-4 | Multi-step reasoning with LangGraph | ✅ | `StateGraph` agent ⇄ tools; step limit; model fallback. |
| FE-2b | Custom actions | ✅ | HTTP tools with encrypted secret headers and an SSRF guard. |
| FE-3 / FE-4 / FE-5 | Admin UI, intent rules, action logs with chain of thought | ✅ | Every number in M2_AGENTIC_TOOLS.md matched the code except the timeout range (corrected). |
| SEC-2 | RBAC on tool APIs | ✅ | Unauthorized attempts return 403 but are **not logged**. |
| SRS examples | Refunds and payment-gateway calls | ❌ | No payment integration. |
| UI-4 | Logs paginated, filterable, sortable | ✅ | — |

---

## 5. Defects found

### 5.1 Fixed in this pass

| ID | Severity | Finding | Fix |
|---|---|---|---|
| BUG-34 | Medium | `src/lib/agent-engine/graph.ts`: when a model asked for more than 4 actions in one step, the extra calls were dropped **without a reply message**. OpenAI-compatible APIs reject the next request when a tool call has no reply, so every model in the chain would have failed and the run would have fallen back. | Every extra call now gets a "not run — call it again next step" reply (`MAX_CALLS_PER_STEP`). New integration test: 6 calls in one step → 4 run, 6 answered. Suite: 43/43. |

### 5.2 Open: settings that do nothing (recommend fixing or hiding before the demo)

| Item | Where | Effect |
|---|---|---|
| "AI Follow-up" and "Close Ticket" automations | `src/lib/agent-automations.ts` (7 defined; `ticket-workflow.ts` runs 5) | Can be switched on but never run. |
| Chatbot "Email notifications" toggle (FR-13.8) | Saved in `app/api/chatbots/route.ts`; used only by the settings preview | No effect on the real widget. |
| Inbox `autoReplyEnabled` (FR-15.5) | Stored only | No UI and no auto-reply sent. |
| `EMAIL` / `VOICE` session-expiry policies | `session-lifecycle.ts` constants | No email or voice chat sessions exist (email runs through tickets). |
| Cron jobs (sessions, knowledge recovery, webhook retries) | `app/api/cron/*` | Nothing schedules them (no `vercel.json`) and `CRON_SECRET` is empty, so the routes return 503. Expiry and recovery still happen lazily, but **webhook retries only run when the cron is called**. |

### 5.3 Other findings

Security-related and lower-priority findings from this pass (logging of refused requests, security headers, rate limits, data erasure across connected systems, retrieval scaling) are recorded with their fixes in **VULNERABILITIES.md**. That register is kept out of the public repository on purpose. New IDs from this pass: SEC-39, DATA-10, UI-44, OPS-13, DOC-07, plus BUG-34 and DOC-08 (fixed).

---

## 6. Corrections made to our documents

| Document | Statement | Correction |
|---|---|---|
| ROADMAP | M1 92%, M7 90%, M10 90%, M5 90%, M8 92%, M4 90%, M2 90%, M9 15%, overall ≈ 66% | Re-scored at FR level: 80 / 85 / 78 / 80 / 88 / 84 / 88, M9 32, overall **≈ 63%**. Linked to this report. |
| ROADMAP | M10 "Pinecone store" ✅ | ⚠️ Coded but not configured; Postgres is used in practice. |
| M4 doc + CHANGELOG | "Tool-action analytics will come with M2" | Done (Reports → AI actions). |
| M4 doc | Leads KPI presented as the SRS rule | Counts all lead sources. |
| M4 doc | "Playground tests are not recorded" | Chatbot *preview* traffic is recorded as website traffic. |
| M8 doc | "`capture_lead` tool will let the LLM decide" | Exists since M2. |
| M8 doc + CHANGELOG | Webhook retries run "whenever the Leads page is open" | Only when the leads API is called on filter, sort or page changes, or by the cron (not scheduled). |
| M8 doc | Forget customer | Also deletes leads, without `lead.deleted` webhooks. |
| M5 doc | Email 7-day / voice 10-minute expiry policies | Defined but unused. |
| M5 doc | Cron "every ~5 min" | Not scheduled in the repo; needs Vercel Cron or another scheduler and `CRON_SECRET`. |
| M5 doc | Playground limited 30/min | Not limited. |
| M5 doc | "10 session starts per IP per hour" | Per chatbot and IP. |
| M5 doc | "Allowed domain" event fully met | The 403 works; the attempt is not logged. |
| M5 / M4 / M8 docs | End-to-end script results (56/56, 43, 72 checks) | Marked as recorded runs whose scripts were not kept; the same areas are now covered by `scripts/e2e/e2e-all.mjs` (131/131). |
| M2 doc | HTTP tool timeout "3–15 s" | UI offers 3/5/10/15 s; the API accepts 1–15 s. |

---

## 7. Non-functional requirements and constraints

| Ref | Requirement | Status | Note |
|---|---|---|---|
| REL-1 / REL-2 | 99.9% uptime; daily backups kept 14 days | ❓ | Depends on hosting; no deployment config in the repo. |
| REL-3 | Pinecone high availability | 🟡 | Pinecone is optional; Postgres fallback. |
| REL-4 | LLM failure handled within 3 s | 🟡 | Logging and fallback work, but timeouts are 12–25 s (free models are slow). |
| PER-1 | Voice under 500 ms | ❌ | No voice pipeline. |
| PER-2 | p95 under 2 s | 🟡 | Not measured; free models take 7–12 s. A Groq key brings this down a lot. |
| PER-3 / PER-4 | Context sync ≤ 1 s; indexing starts ≤ 10 s | 🟡 | Designed for it; not measured. |
| SEC-1 | TLS and HTTP→HTTPS | 🟡 | Left to the host; secure cookies in production; no HSTS or CSP. |
| SEC-2 | RBAC | ✅ | Unauthorized attempts not logged. |
| SEC-3 | Card data via Stripe | n/a | No payments yet. |
| SEC-4 | Tenant isolation | ✅ | Workspace-scoped queries; Pinecone namespaces; checked by tests. |
| USE-1…4 | Quick deploy, inline validation, zero onboarding, plain errors | 🟡 / ✅ | Errors are plain and actionable; inline validation is not on every form. |
| CI-1 | WebSockets | ⚠️ | SSE (documented). |
| CI-3 | Signed webhooks | ✅ | — |
| CON-1 / 3 / 4 | Next.js 15, Prisma, LangGraph | ✅ | — |
| CON-2 | Zustand + TanStack Query | ❌ | Installed, never imported. |
| CON-5 | Deepgram + TTS | ❌ | Not used (voice is out of the 60% scope). |
| CON-6 / CON-7 | Firecrawl, Cloudinary | 🟡 | Coded with fallbacks; not configured. |
| CON-8 / SI-4 | Stripe, Twilio/Vapi | ❌ | M3 and voice scope. |

---

## 8. SDS vs code

- **Every SDS entity exists in code:** all 17 classes are in `prisma/schema.prisma`.
- **19 code models are not in the SDS:**
  - Module 2: AgentTool, AgentToolBinding, AgentRun, ToolExecution, Appointment.
  - Module 5: Contact, SessionEvent, RateLimitBucket.
  - Module 8: Lead, LeadEvent, WebhookEndpoint, WebhookDelivery.
  - Module 4: AiInteraction, MessageFeedback.
  - Other: KnowledgeChunk, Integration, Notification, PromptTemplate, ApiKey.
- **SDS statements that are now wrong:**
  - "Vector storage not yet active": Pinecone is coded.
  - "Custom TypeScript AI runtime": LangGraph is used now.
  - "Future channel integration layer": Slack, WhatsApp and email exist.
  - CannedResponse field `content` is really `body`.
  - Chapter 5 lists 5 unit tests; the repo has 139 unit and 43 integration tests.
- **Flows missing from the SDS:**
  - the tool-calling loop with confirmation;
  - widget, WhatsApp and Slack conversations;
  - human takeover;
  - lead capture and webhooks;
  - the indexing queue;
  - SSE live updates;
  - session expiry.

**The SDS must be updated for the 60% submission (R1).** Evaluators will compare it with the code.

---

## 9. Recommended actions (priority order)

| # | Action | Why | Effort |
|---|---|---|---|
| R1 | **Update the SDS:** class diagram (36 models), sequence diagrams for the M2 tool loop, M5 chat and takeover, M8 lead and webhook, M4 analytics; fix the stale statements; rewrite Chapter 5 tests from this report. | Largest evaluation risk. | 1 day |
| R2 | ~~Run `e2e-all.mjs`~~ **done: 131/131.** Re-run `e2e-m2.mjs` after the AI quota resets or with a Groq key. | Completes the Module 2 runtime re-check. | 5 min |
| R3 | ~~Move the end-to-end scripts into the repo~~ **done:** `scripts/e2e/` with README; credentials come from environment variables. | Evaluators can re-run them. | — |
| R4 | Fix or hide the five do-nothing settings (§5.2), and add `vercel.json` cron entries plus `CRON_SECRET`. | Avoid a demo surprise. | 2–3 h |
| R5 | Add a free **Groq key** (or $10 of OpenRouter credit for 1,000 free-model requests a day); optionally set Pinecone and Firecrawl keys. | **The free OpenRouter tier (50 requests/day) ran out during testing, and it would run out during a demo.** Also speed (PER-2, REL-4), and the named technologies run live. | 15 min |
| R6 | Log refused requests (403s, refused widget origins) in a small audit table. | SRS events and M11 FE-5. | 3 h |
| R7 | In the viva, state the documented deviations: SSE instead of WebSockets, Postgres instead of Redis, no voice in the 60% scope, Zustand/TanStack not needed with server components. | Pre-empts questions. | — |

---

## 10. Files

- This report: `VERIFICATION_REPORT.md`
- Fix: `src/lib/agent-engine/graph.ts`; test in `tests/integration/agent-engine.int.ts`
- Documents corrected: `ROADMAP.md`, `M2_AGENTIC_TOOLS.md`, `M4_ANALYTICS.md`, `M5_SESSION_CONTEXT.md`, `M8_LEAD_GENERATION.md`, `CHANGELOG.md` (verification entry); `VULNERABILITIES.md` (local)
- End-to-end scripts: `scripts/e2e/` (`e2e-all.mjs`, `e2e-m2.mjs`, `setup-m2.mjs`, `config.mjs`, README)
- Test evidence (local): `unit-verbose.txt`, `integration.txt`, `schema-drift.txt`, `e2e-all-final.txt`, `e2e-m2-final.txt`
