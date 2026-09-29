# AssistDesk — Roadmap to 60% Implementation

**Team:** Muhammad Awais (SP23-BSE-031) · Ahmad Mujtaba Shahid (SP23-BSE-003) · Supervisor: Amir Shabir Parre
**Written:** 2026-09-28 · **Deadline:** **Thursday 15 Oct 2026** (17 days)
**Companion files:** [VULNERABILITIES.md](VULNERABILITIES.md) (issue register) · [CHANGELOG.md](CHANGELOG.md) (work log, updated after each big chunk)

---

## 1. Where we are (30% milestone as submitted in the SDS)

The SDS (Ch. 4.1.3) and the SDS slides claim **Modules 1, 7 and 10, plus Module 5 (partial)**. The code audit agrees with that scope, with the quality gaps listed in VULNERABILITIES.md.

### Module completion vs the Proposal/SRS feature lists

| # | Module | FE done | Now | Notes (what exists → what's missing) |
|---|---|---|---|---|
| M1 | Assistant Creation & Omnichannel | FE-1 ✅, FE-2 ✅, FE-3 ✅, FE-4 ✅, FE-5 ✅ | **~~65%~~ → 92%** *(2026-09-28)* | Done: agent tone, length and token limit; avatar and conversation starters; PDF/DOCX; website crawl (Firecrawl or built-in); Slack and WhatsApp; outbound email; working reply modes; publish; secure widget with attachments, emoji and voice. Remaining: live Slack/WhatsApp/SMTP tests with real accounts, and WhatsApp media messages. |
| M7 | User Dashboard | FE-1 ✅, FE-2 ✅, FE-3 ✅, FE-4 ✅, FE-5 ✅ | **~~70%~~ → 90%** *(2026-09-29)* | Done: Overview with per-agent performance + notifications bell (FE-3); tickets with server pagination/filters/bulk actions (FR-5); Prompts page (FR-9); real Reports; users/profile with RBAC, temporary passwords and password change (FE-5); mobile menu; loading/error pages. Remaining: agent attachments/emoji in Chats (FR-6.6/6.7), customer presence dot (FR-6.2), API Keys page (M11). |
| M10 | Knowledge Base Management | FE-1 ✅, FE-2 ✅, FE-3 ✅, FE-4 ✅, FE-5 ✅ | **~~60%~~ → 90%** *(2026-09-29)* | Done: real embeddings (OpenRouter text-embedding-3-small), Pinecone store with namespace per workspace (switches on with PINECONE_API_KEY/INDEX), section-aware chunking, hybrid semantic+keyword retrieval with the confidence threshold, durable indexing queue with recovery, vector purge on delete, search/sort/pagination, chunk viewer and Test retrieval. Remaining: live Pinecone test with a real key, scanned-PDF OCR. |
| M5 | Real-Time Context & Session *(the half module)* | FE-1 ✅, FE-2 ✅, FE-3 ✅, FE-4 ✅, FE-5 ✅, FE-6 ✅ | **~~25%~~ → 90%** *(2026-09-29)* | Done: session lifecycle (ACTIVE ⇄ ESCALATED → CLOSED, reason + resolution, closed sessions final and linked to the next), secret hashed widget tokens, per-channel expiry + cron, Contact-based Unified Memory Buffer across Website/WhatsApp/Slack/Email, 3-layer memory (history, rolling summary, customer profile) with trust-based redaction, Postgres rate limiter with 429 + logs, SSE live updates (2–52 ms), email threading, Chats context panel, Contacts pages. Full write-up: [M5_SESSION_CONTEXT.md](M5_SESSION_CONTEXT.md). Remaining: voice channel (M3 scope), multi-instance push (Redis/NOTIFY), email OTP identity verification. |
| M6 | LLM Management & Fast Inference | FE-1 ✅, FE-2 ✅, FE-4 ◐, others ✗ | 30% (bonus) | Multi-provider runtime and per-agent model choice already work. Missing: feedback loop, streaming, voice (VAD/TTS). |
| M11 | Integrations & RBAC | FE-1 ◐, FE-3 ✅, FE-4 ✅, FE-5 ◐ | 45% (bonus) | RBAC enforced on all mutating APIs (Owner/Admin/Manager/Agent), Slack/WhatsApp/email channels. Missing: audit log, API keys page, CRM connectors. |
| M4 | Monitoring & Analytics | FE-1 ◐, FE-2 ✅, FE-3 ◐, FE-4 ◐ | 35% | Transcripts stored; Overview KPIs and Reports use real numbers. Missing: charts (24h latency), trends, FAQ insights, exports. |
| M2 | Agentic Tool & Action Mgmt | FE-5 ◐ | 10% | "Automations" are regex rules and AutomationLog acts as an action log. No tool registry and no LangGraph. |
| M8 | Lead Generation | FE-2 ◐ | 10% | The widget can require name/email/phone. No Lead model, page, webhooks or notifications. |
| M9 | Support Escalation | FE-1 ◐ | 15% | Human takeover from the Chats page (M5): take over, hand back, team replies pause the AI, AI reply limit → human-only. Missing: escalation rules, queues/assignment, SLA. |
| M3 | Subscription & Payment | — | 0% | Stripe is installed but unused. |
| | **Overall (11 modules, equal weight)** | | **≈ 29% → ≈ 46%** *(2026-09-29)* | 29% matched the SDS 30% claim; after M1, M7, M10 and M5 it is ≈ 46%. Next: M2, M8, M4 to pass 60%. |

✅ done · ◐ partial · ✗ missing

**Honest risk for the evaluation:** SDS Chapter 5 describes unit, functional and integration tests, but **the repo has no tests or test runner** (DOC-01). The SRS also names Pinecone, LangGraph, Zustand, TanStack Query and Firecrawl, none of which are used yet (DOC-02/03/04). The 60% build fixes most of this.

---

## 2. Chosen modules for the 60% milestone

To reach 60% of 11 modules we need about 6.6 modules. The plan targets **7 complete modules (≈64%)** plus bonus progress, so there is buffer:

| Status at 60% | Module | Why this one |
|---|---|---|
| Already claimed, **harden** | M1, M7, M10 | Evaluators re-test these. The Critical/High issues must go, and M10 must get **real embeddings + Pinecone** as the SRS promises. |
| **Finish** (the half module) | **M5 Real-Time Context & Session** | It was declared partial at 30%, so it must be closed now. The widget already writes sessions, so this is cheap. |
| **New** | **M8 Lead Generation** | Mostly builds on existing widget fields. Quick, visible win. It is in Ahmad's proposal work split (M8 FE-1–3). |
| **New** | **M2 Agentic Tool & Action Management** | This is *the* differentiator in the proposal ("execution layer, not conversation layer"). LangGraph is already installed. It is in both members' work splits (Awais FE-1–2, Ahmad FE-3–4). |
| **New** | **M4 Monitoring & Analytics** | It replaces the fake Reports numbers, satisfies SRS FR-11, and aggregates data from M5/M8/M2. It is in Awais's work split (M4 FE-1–3). Built **last** because it consumes the others. |
| Bonus (falls out of the above) | M9 (basic handoff), M6 FE-3 (feedback), M11 FE-3/4 (RBAC enforced) | Human takeover in M5 is escalation-lite. Thumbs up/down in the widget feeds M4. RBAC is a P0 security fix anyway. |
| Deferred to final 100% | M3 Stripe, M6 voice (Deepgram/TTS/VAD), WhatsApp/Slack, full M9 sentiment escalation | These are the heaviest external-service work, with no dependency from the 60% set. |

This choice follows the **Module-based Work Division table in the Proposal** exactly: Ahmad takes M5 + M8 + M2 FE-3/4, and Awais takes M2 FE-1/2 + M4 + M6 FE-3. That is easy to defend in the viva.

### Target completion at 15 Oct

| Module | Now | Target | | Module | Now | Target |
|---|---|---|---|---|---|---|
| M1 | 65% → **92%** ✅ | 85% | | M2 | 10% | 75% |
| M7 | 70% → **90%** ✅ | 90% | | M8 | 10% | 85% |
| M10 | 60% → **90%** ✅ | 85% | | M4 | 20% | 85% |
| M5 | 25% → **90%** ✅ | 90% | | M6 | 30% | 45% |
| M9 | 5% → 15% | 30% | | M11 | 25% → 45% | 45% |
| M3 | 0% | 0% | | **Overall** | **≈29%** | **≈65%** |

---

## 3. Timeline (17 days)

```
Sep 29 ─ Oct 1   P0  Stabilise: commit, DB, tests, Critical/High security   (both)
Oct 1  ─ Oct 4   P1  M5 sessions & context                                  (Ahmad)
Oct 1  ─ Oct 4   P2  M10 real embeddings + Pinecone, KB fixes               (Awais)
Oct 4  ─ Oct 7   P3  M8 lead generation                                     (Ahmad)
Oct 4  ─ Oct 9   P4  M2 agentic tools (LangGraph) + LLM runtime hardening   (Awais lead, Ahmad FE-3/4 UI from Oct 7)
Oct 9  ─ Oct 12  P5  M4 analytics + M6 feedback loop + API keys page        (Awais; Ahmad on tests)
Oct 12 ─ Oct 15  P6  Tests, UI polish, docs/SDS update, demo rehearsal      (both)
```

Buffer rule: if a phase slips more than one day, cut its **stretch** items (marked ⭐), never the P6 testing days.

---

## 4. Phase details

Each task lists the issue IDs it closes. "Done" means: works in the UI, has at least one test, and has a CHANGELOG entry.

### P0 — Stabilise (Tue 29 Sep → Thu 1 Oct) · both

**Day 1 — the starting point (do these first, in this order):**
1. **Commit the uncommitted widget runtime** (OPS-01, DATA-08) on a branch `feat/widget-runtime`, then merge. Add `.chrome-*/` and `storage/` to `.gitignore` (OPS-06).
2. **Database:** install PostgreSQL 15 locally, or use a free Neon/Supabase Postgres. Run `npx prisma migrate deploy` and `npx prisma generate`. Add `.env.example` and replace the README with real setup steps (OPS-02).
3. **Test harness:** add Vitest with a `test` script. Write the 5 unit tests the SDS already claims (password hashing, slug, chunking, retrieval scoring, provider resolution) (DOC-01). Fix the ESLint Next plugin warning (OPS-04), and fix or remove the stale AGENTS.md note (OPS-05).

**Days 2–3 — security and correctness (Critical/High first):**
- Auth: use `bcryptjs` (or `argon2`) with a migration-on-login from SHA-256, and remove the plaintext comparison. Enforce a minimum password length of 8. Add a login rate limit. Add a `secure` cookie in production. Store a hash of the session token (SEC-01, 05, 13).
- Add a Prisma `omit: { user: { passwordHash: true } }` global, and select only needed fields in every `include: { assignee/createdBy/user }` (SEC-01).
- Guard `ensureDemoData()` behind `NODE_ENV !== "production"` **and** an explicit `ASSISTDESK_SEED_DEMO=true`. Remove the credentials from the login page (SEC-02, UI-06).
- Email webhook: require `secret` (in a header, not the body). Look up by secret only. Make `supportAddress` unique per type. Validate the body (SEC-03, 11).
- **RBAC helper** `requireRole(session, ["OWNER","ADMIN"])`, applied to users, settings, integrations, agents, inboxes and deletes. Block self-promotion and actions on the OWNER (SEC-04, UI-22, DOC-05). *This also counts toward M11 FE-3/4.*
- Invites: replace `welcome123` with a random temporary password, shown once, plus a "must change password" flag. Add a `PATCH /api/profile/password` endpoint (SEC-06).
- Stop sending provider API keys and webhook secrets to the client: return a masked `sk-…abcd` and a `hasApiKey` flag, and keep the existing key when the field is left blank on edit. Encrypt keys at rest with AES-256-GCM using `ASSISTDESK_ENCRYPTION_KEY` (SEC-10, 19, 25).
- SSRF guard for URL sources: http/https only; block private, loopback and link-local IPs after DNS resolution; `redirect: "manual"` with checks on each hop; a 2 MB streamed size cap (SEC-09).
- A shared `parseJson(request, zodSchema)` helper: add `zod`, return 400s instead of 500s, validate enums properly, map P2002 to 409 (BUG-14, 15, 20, 24, SEC-16, 23).
- Security headers in `next.config.ts`: CSP and frame-ancestors for the dashboard; the widget route is allowed to be framed (SEC-14).
- Quick bug fixes: ticket filters (BUG-01), newest tickets and real pagination (BUG-02, UI-01), block-list (BUG-03), auto-assign only when enabled (BUG-05), ticketNumber in a transaction with retry (BUG-07), internal notes must not change status or preview (BUG-09, DATA-04), ticket patch races (BUG-16), double-submit on Create Ticket (BUG-17), canned-response variables (BUG-18), setup wizard (BUG-19), playground double send (BUG-21), `Chatbot.agent` → `Restrict` with a UI warning (DATA-02), signup in `$transaction` (DATA-03), date hydration with a fixed `timeZone` (UI-19), `loading.tsx` / `error.tsx` (UI-20), errors shown inside modals (UI-11), drawer scroll (UI-12), KB delete confirmation (UI-8), ticket label fixes (UI-33).

**Exit criteria:** all 4 Critical and all High **security** items are closed, CI-style `npm run lint && npm test && npm run build` is green, and the app runs locally on a fresh DB.

---

### P1 — M5 Real-Time Context & Session Management (Thu 1 → Sun 4 Oct) · Ahmad

> ✅ **Done 2026-09-29, ahead of schedule.** What was built (and where it differs from this plan: SSE instead of 3 s polling; WhatsApp and Slack already plug into the Contact; memory has a trust level) is documented in [M5_SESSION_CONTEXT.md](M5_SESSION_CONTEXT.md) and the CHANGELOG. The table below is the original plan, kept for reference.

| FE | Deliverable |
|---|---|
| FE-1 Create/maintain sessions | Widget sessions get a **secret `sessionToken`** (random 32 bytes, hashed in the DB), separate from the id (SEC-18). Contact fields are no longer wiped (SEC-18). An inactive bot must not create sessions (SEC-26). |
| FE-3 Preserve context | The LLM receives the **last N messages** of the session (sliding window, e.g. 12 turns / ~3k tokens), plus a short rolling summary for longer chats (BUG-13). |
| FE-2 Cross-platform context | New **`Contact`** model (workspaceId + email/phone unique). Widget sessions and email tickets link to the Contact. When a known contact chats, the prompt includes a "previous interactions" summary (last tickets and sessions). This covers email ↔ web now; WhatsApp and voice plug into the same Contact later. |
| FE-4 Session history | The Chats page lists sessions with pagination, filters by status and channel, loads the newest messages, and gets a Contact side panel (BUG-22, UI-05). |
| FE-5 Expiration | `lastActivityAt` column. Sessions idle for 30 min (configurable per chatbot) become `CLOSED` with `endedAt`, handled lazily on access plus a `/api/cron/sessions` route (Vercel Cron). The widget starts a new session with the old context linked through the Contact. |
| FE-6 Rate limiting | A Postgres-backed fixed-window limiter (`RateLimitBucket` table: key, window, count) behind `rateLimit(key, limit, windowSec)`. Applied per IP + widget on widget messages (e.g. 20/min), per IP on login (5/min), and on the email webhook. Returns 429 with `Retry-After` (SEC-08). |
| Widget security | Server-side allow-list check using only `Origin`/`Referer` from the browser, **fail-closed** when `allowedDomains` is non-empty. Remove `?host=`. `frame-ancestors` is generated from `allowedDomains`. `additionalPrompt` is removed from the public config (SEC-07, 20). |
| Human takeover *(M9-lite)* | An agent can **reply from the Chats page**. "Take over" sets the session to `ESCALATED` and pauses the AI. "Return to AI" resumes it. The widget **polls every 3 s** (or SSE ⭐) for new messages and shows the online/offline status from agent presence (UI-14, UI-16). Honour `replyMode` (ALWAYS / OPERATOR_OFFLINE / FALLBACK) (BUG-13). |
| ⭐ Outbound email | Send ticket replies through Resend or SMTP (nodemailer) from the inbox sender, and thread inbound mail by `In-Reply-To` (BUG-04, BUG-08). |

Schema: `Contact`, `ChatSession.sessionTokenHash / lastActivityAt / contactId / aiPaused`, `Ticket.contactId`, `RateLimitBucket`.
Use **TanStack Query** for the Chats page polling and **Zustand** for the active-conversation store (DOC-03).

---

### P2 — M10 Knowledge Base upgrade (Thu 1 → Sun 4 Oct) · Awais

- **Real embeddings:** Google `gemini-embedding-001` / `text-embedding-004` through the managed Google key that is already in `.env` (free tier), behind an `embed(texts[])` interface so OpenAI embeddings can be swapped in (AI-01).
- **Pinecone** serverless index (free Starter plan), with one **namespace per workspace** for tenant isolation (SRS SEC-4) and metadata `{sourceId, agentId, chunkIndex}`. Keep Postgres `KnowledgeChunk` as the source of truth for text; Pinecone holds only vectors. Fall back to Postgres cosine search if `PINECONE_API_KEY` is unset, so the demo never breaks (DOC-02).
- Better context: top-k = 5, pass the **full chunk** (not 360 characters), apply `confidenceThreshold` on the LLM path, and return the "I don't know / escalate" path below the threshold (AI-02, AI-04).
- **Durable processing:** process the job in the request via `after()` (Next 15), plus a recovery sweep that re-queues `PROCESSING` sources older than 5 minutes. Sources start as `PENDING` (BUG-11).
- URL re-sync re-fetches for real. The status field can't be set by the client. Retrieval filters out `DELETED` (BUG-10, SEC-24). Remove chat-time hydration (BUG-12). Chunk replace inside a transaction (DATA-05).
- **PDF and DOCX** support with `unpdf` and `mammoth`. A 10 MB upload limit, a MIME allow-list, and **drag-and-drop** upload (SEC-15, UI-38).
- ⭐ Firecrawl for URL crawling when `FIRECRAWL_API_KEY` is set (DOC-04). Collapse the three look-alike process buttons into one "Re-sync" (UI-09). Make "Test URL" do a real HEAD check (UI-30).

---

### P3 — M8 Lead Generation (Sun 4 → Wed 7 Oct) · Ahmad

| FE | Deliverable |
|---|---|
| FE-1 Lead capture forms | A per-chatbot **Lead Form builder** (fields: name, email, phone, company, plus custom text/select fields, each required or optional). Trigger: on start, after N messages, or when the AI detects buying intent (a simple LLM classification). It renders as an inline card in the widget (SRS FR-17.5). |
| FE-2 Auto-collect info | A `Lead` model (workspaceId, chatbotId, sessionId, contactId, fields JSON, source, status NEW/CONTACTED/QUALIFIED/LOST, score). The AI also extracts an email or phone typed in free chat. |
| FE-3 Notifications | An in-app notification bell (a `Notification` model, which also serves M7 FE-3). Optional email and a **Slack incoming-webhook URL** per chatbot. |
| FE-4 Export / webhooks | CSV export. An outgoing webhook per workspace with an **HMAC-SHA256 signature header** (SRS CI-3), a retry log, and a "Send test" button. |
| FE-5 Lead database | A `/dashboard/leads` page with search, status filter, sorting, pagination, a detail drawer linking to the chat transcript, and status updates (SRS UI-4). |

---

### P4 — M2 Agentic Tool & Action Management (Sun 4 → Fri 9 Oct) · Awais lead, Ahmad FE-3/4 from Wed 7

- **Tool registry** (`AgentTool` model): name, description, `type` (BUILT_IN / HTTP), a JSON-Schema of parameters, HTTP method, URL template, headers (secrets encrypted), `requiresConfirmation`, and enabled per agent.
- **Built-in tools (FE-1):** `lookup_ticket_status`, `create_ticket`, `capture_lead` (→ M8), `escalate_to_human` (→ M5 takeover), `search_knowledge_base`, `book_appointment` (writes an `Appointment` row), and `get_customer_info` (Contact).
- **Custom actions (FE-2b/FE-3):** an HTTP tool builder UI with a "Test tool" button. It reuses the SSRF guard from P0.
- **Multi-step reasoning (FE-2, SRS CON-4):** a **LangGraph** `StateGraph` ReAct loop (`agent → tools → agent`), max 5 steps, 20 s budget. Use `@langchain/openai` `ChatOpenAI` pointed at Groq/OpenRouter (both OpenAI-compatible) so the managed keys work. It is used by the widget, the playground and the ticket AI-response.
- **Intent → action mapping (FE-4):** per-agent rules such as "when the user wants X, prefer tool Y", injected into the system prompt, plus an optional forced tool.
- **Action logs / chain of thought (FE-5):** a `ToolExecution` model (sessionId/ticketId, step, tool, input, output, status, latency, and the model's reasoning text). It appears as a timeline in the Playground and on a new "Action Logs" tab in Logs (pagination and filters).
- **LLM runtime hardening in this phase:** `AbortController` timeouts (8 s per call, 3 s to first fallback), logged errors, honouring the agent temperature, updated model catalog, the Google key in a header, a playground badge when the fallback answered, and delimited, role-separated prompts to reduce prompt injection. Internal notes are excluded from drafts (AI-03, 05, 06, 09, SEC-12, SEC-22).
- ⭐ Replace the regex priority/tag classification with an LLM classification call (AI-07). Add the token-limit field (UI-26).

---

### P5 — M4 Monitoring & Analytics + M6 FE-3 (Fri 9 → Mon 12 Oct) · Awais (Ahmad: tests)

- **Event capture (FE-1):** record `latencyMs`, tokens, model, `resolvedBy` (AI/HUMAN) and escalated flag for every AI reply, in `AutomationLog` or a new `InteractionMetric`.
- **Analytics dashboard (FE-3, SRS FR-11.1–11.7):** KPI cards for avg AI response time, % AI-resolved without escalation, leads captured, active sessions and CSAT (from the feedback below). A **24 h latency line chart**, conversation volume by channel, and a **Recent interactions** table with channel icons, status and duration. Date-range picker. Use `recharts` (or a lightweight SVG chart).
- **Reports (FE-4):** top questions and FAQ clusters (group the most frequent user messages by embedding similarity from P2), top tools used, tickets by status, priority and source, and CSV export.
- **Improvement areas (FE-5):** a list of "unanswered / low-confidence questions" and thumbs-down replies, with an "Add to knowledge base" shortcut.
- **M6 FE-3 feedback loop:** 👍/👎 on each AI message in the widget and playground (a `MessageFeedback` model). Thumbs-down replies feed the FE-5 list.
- Remove the fake numbers (DATA-01, DATA-09, UI-04, UI-27). Add a Logs Ticket column and pagination (UI-36).
- **API Keys page (M11 FE-2):** create and revoke workspace API keys (hashed, shown once) plus a minimal public `POST /api/v1/tickets` authenticated by an API key (UI-03).

---

### P6 — Test, polish, document, rehearse (Mon 12 → Thu 15 Oct) · both

- **Tests:** unit tests (Vitest) for rate limiter, RBAC, SSRF guard, chunking and embedding, tool execution, lead webhook signing, and analytics aggregation. Route-level integration tests against a test DB. Write up the tests that already exist in SDS Ch. 5 and add new cases for M2/M4/M5/M8.
- **UI polish:** mobile sidebar drawer (A11Y-01), labels and aria (A11Y-02–04), remove leftover developer copy (UI-34), dead toolbar buttons (hide or implement: UI-07), empty states (UI-32), inline validation on the key forms (UI-23), a Prompts page ⭐ (UI-25), bulk ticket actions ⭐ (UI-02).
- **Audit log ⭐** (SEC-27, M11 FE-5): an `AuditLog` for logins, role changes, deletes and key changes.
- **Docs:** update the SDS/implementation chapter for 60% (new class diagram entities, sequence diagrams for the tool-calling loop and human takeover, screenshots). Update VULNERABILITIES.md statuses and write the final CHANGELOG entry.
- **Demo script:** seeded demo workspace (dev only), a 10-minute walkthrough (widget chat → tool call → lead captured → human takeover → analytics updates), and a backup video recording.

---

## 5. Decisions to confirm (defaults chosen so work can start)

| Topic | Default in this plan | Alternative |
|---|---|---|
| Database for dev/demo | Neon free Postgres (shared by both members, no local install) | Local PostgreSQL 15 |
| Embeddings | Google `text-embedding-004` / `gemini-embedding-001` (key already in `.env`) | OpenAI `text-embedding-3-small` |
| Vector DB | Pinecone serverless free tier, namespace per workspace | pgvector in Postgres |
| LangGraph LLM | Groq `llama-3.3-70b-versatile` (fast tool calling) via the OpenAI-compatible API | OpenRouter models |
| Outbound email | Resend (free tier) | SMTP/nodemailer |
| Charts | recharts | hand-rolled SVG |
| Background jobs | `after()` + Vercel Cron routes | a queue service (Inngest/QStash) |

## 6. Risks

| Risk | Mitigation |
|---|---|
| Free-tier LLM keys rate-limit during the demo | Fallback chain across Groq → OpenRouter → Google; record a backup demo video. |
| LangGraph tool calling is flaky on small models | Use Groq Llama-3.3-70B; cap at 5 steps; keep deterministic built-in tools; add a playground trace for debugging. |
| Two people editing `schema.prisma` at once | One migration per PR; pull before every migration; Ahmad owns P1/P3 models and Awais owns P2/P4/P5 models. |
| Scope creep | Stretch items (⭐) are cut first; P6 is protected. |

## 7. Working rules

- Branch per phase (`feat/p1-sessions`, `feat/p4-agent-tools`, …). Small PRs into `main`, and never leave work uncommitted overnight.
- Each big chunk gets a CHANGELOG entry (date, module, files, added/fixed/updated), and each fixed issue gets its status changed in VULNERABILITIES.md.
- Before each merge: `npm run lint && npm test && npm run build`.
