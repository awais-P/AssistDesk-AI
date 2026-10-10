# Module 5: Real-Time Context & Session Management

> **Status:** about 90% implemented (29 Sep 2026). Everything in the 60% scope works end to end; voice is deferred (see §2).
> **Owner (Proposal work split):** Ahmad Mujtaba Shahid · built with Muhammad Awais
> **Related files:** [CHANGELOG.md](CHANGELOG.md) (what changed and when) · [ROADMAP.md](ROADMAP.md) (plan and percentages) · `VULNERABILITIES.md` (local issue register)

This is the single reference for Module 5. It covers what the module is for, how we interpreted the documents, how sessions and memory work, and how to demonstrate it.

---

## 1. What the module is for

The Proposal defines Module 5 as *"maintaining the conversation state across all channels, so the AI remembers what the customer said before"*. The SRS lists six features plus backend events:

| ID | Feature (Proposal / SRS) | One-line meaning |
|---|---|---|
| FE-1 | Create and maintain chat sessions | Every conversation is a session with a clear lifecycle. |
| FE-2 | Cross-platform context synchronisation | A customer who switches channel continues where they left off. |
| FE-3 | Preserve conversation context | The AI sees the conversation so far, including very long ones. |
| FE-4 | Store and retrieve session history | The team can browse past sessions per customer. |
| FE-5 | Session expiration policies | Idle conversations close automatically, each channel with its own rules. |
| FE-6 | Rate limiting for session requests | Abuse and cost protection: excess requests get HTTP 429 and are logged. |

SRS backend events that must happen:

1. A session starts when a visitor on an **allowed domain** sends a message.
2. Every message is appended to the **Unified Memory Buffer**.
3. On a channel switch, the previous context is **loaded into the new channel**.
4. A rate-limit breach returns **429** and is **logged**.
5. Session expiry or termination is **logged**.
6. Reply modes are respected, and when the AI reply limit is reached the chat becomes **human-only** and this is logged.

Non-functional targets: **PER-3** (context synchronised in ≤ 1 s) and **CI-1** (live updates in the dashboard and widget).

---

## 2. The "different scenario": how we adapted the documents

The documents describe the ideal product. For the 60% milestone (15 Oct 2026) we kept the **intent** of every requirement but changed some of the means.

| Document says | We built | Why |
|---|---|---|
| FE-2 example: *customer starts on WhatsApp and continues on a **voice call*** | Continuity across **Website widget ↔ WhatsApp ↔ Slack ↔ Email** | Voice (Deepgram/Vapi, Module 3) is outside the 60% scope. The mechanism is channel-agnostic: `VOICE` is already a channel value with its own expiry policy (10 min), so adding voice later means adding one more inbound adapter. |
| "Unified Memory Buffer" (implied Redis) | A **Contact** record plus three memory layers in **PostgreSQL** | One database is simpler to run and demo, and it stays consistent. Everything lives in tables we can show in the viva. |
| WebSockets for real-time updates | **Server-Sent Events (SSE)** with a polling fallback | Works on serverless and Next.js route handlers without a separate socket server. Measured delivery of a team reply to the widget: **2–52 ms** (PER-3 target 1 s). |
| Redis-based rate limiter | **PostgreSQL rate limiter** (atomic upsert) | Shared across server instances and restarts, with no extra infrastructure. |

**Outcome:** a customer can talk to the website bot, close the tab, message the business on WhatsApp the next day, then send an email, and on every channel the AI already knows who they are and what they asked. Their personal details stay protected when their identity is not verified.

---

## 3. Architecture at a glance

```
 Website widget ─┐   (session token, visitor id,         ┌──────────────────────────────┐
 WhatsApp  ──────┤    typed email / phone)               │  PostgreSQL                  │
 Slack     ──────┼──► resolveContact()  ───────────────► │  Contact  (one per customer) │
 Email     ──────┘    (contacts.ts)                      │   ├─ ChatSession (per convo) │
                          │                              │   │   ├─ ChatMessage         │
                          ▼                              │   │   └─ SessionEvent (audit)│
              session-lifecycle.ts                       │   ├─ Ticket (email)          │
   start / continue / expire / close a session           │   └─ memory (AI profile)     │
                          │                              │  RateLimitBucket             │
                          ▼                              └──────────────────────────────┘
              appendSessionMessage()  ──► realtime.ts (event bus) ──► SSE streams
                          │                                             ├─ widget  (/stream)
                          ▼                                             └─ dashboard (/events)
              conversation-runtime.ts
   history (12 msgs) + rolling summary + customer memory
                          │
                          ▼
              llm-runtime.ts  →  AI reply  →  back to the channel
                          │
                          ▼ (after the response, in the background)
              session-memory.ts: summaries, customer profile
```

---

## 4. Data model

The migrations are `20260929180000_module5_sessions`, `20260929190000_module5_email_threading` and `20260929200000_module5_session_visitor`.

| Model / field | Purpose |
|---|---|
| **`Contact`** | One per real customer per workspace. It holds the identities `email`, `phone` (E.164), `whatsappId`, `slackUserId` and `visitorId` (anonymous browser id), each unique per workspace. It also holds `memory` (the AI profile), `memoryUpdatedAt`, `lastChannel`, `firstSeenAt` and `lastSeenAt`. |
| `ChatSession.contactId` | Links the conversation to the customer. |
| `ChatSession.previousSessionId` | Links a new session to the one before it (continuation chain). |
| `ChatSession.sessionTokenHash` | SHA-256 of the widget's secret session token. The token itself is never stored. |
| `ChatSession.lastActivityAt` | The idle clock. Only customer, AI and agent messages move it; system notices do not. |
| `ChatSession.closedReason` | `IDLE_TIMEOUT` · `MAX_DURATION` · `CLOSED_BY_CUSTOMER` · `CLOSED_BY_AGENT` |
| `ChatSession.resolution` | `AI_RESOLVED` · `HUMAN_HANDLED` · `UNANSWERED` (set on close; feeds Module 4 analytics). |
| `ChatSession.summary`, `summarizedMessageCount` | Rolling and final summary of the conversation. |
| `ChatSession.messageCount`, `aiMessageCount` | Counters, so no query is needed to enforce the AI reply limit. |
| `ChatSession.clientIpHash`, `visitorId` | Keyed hash of the IP (never the raw address) and the browser id, used for the trust level. |
| **`SessionEvent`** | Audit trail: `SESSION_STARTED`, `SESSION_RESUMED`, `SESSION_EXPIRED`, `SESSION_CLOSED`, `CONTACT_CREATED`, `CHANNEL_LINKED`, `CONTACTS_MERGED`, `IDENTITY_LINKED`, `CONTEXT_CARRIED`, `RATE_LIMITED`, `HUMAN_TAKEOVER`, `AI_RESUMED`, `AI_LIMIT_REACHED`, `AI_FALLBACK_REPLY`, `MEMORY_EDITED`, `CONTACT_ERASED`. |
| **`RateLimitBucket`** | Fixed-window counters (`key`, `windowStart`, `count`). |
| `Chatbot.sessionTimeoutMinutes` (30), `rateLimitPerMinute` (10) | Per-chatbot policy, editable in Chatbot settings. |
| `WorkspaceSetting.crossChannelMemory` (true) | Workspace switch for cross-channel memory. |
| `Ticket.contactId`, `TicketMessage.externalId` | Email tickets belong to the Contact; the email Message-ID deduplicates retries. |

---

## 5. How sessions work

### 5.1 Lifecycle

```
            first message
                 │
                 ▼
   ┌────────► ACTIVE ◄──────────┐  "Hand back to AI"
   │             │              │
   │   team replies / Take over │
   │             ▼              │
   │         ESCALATED ─────────┘        (AI paused, human answers)
   │             │
   │  idle timeout · max duration · customer "End chat" · team "Close"
   │             ▼
   │          CLOSED  (final: reason + resolution + final summary + memory update)
   │             │
   └── next customer message ──► NEW session, previousSessionId → old one,
                                  same Contact, context carried over
```

**Key rule:** *a closed session is never reopened.* The customer's next message always creates a new session linked to the old one. This keeps every session a clean unit for history, analytics and summaries, while the customer notices no break because the AI carries the context over. The dashboard therefore offers no "Reopen" (the API returns 409), and a team reply into a closed conversation is refused, because the customer would never see it.

### 5.2 Expiration policies (FE-5)

| Channel | Idle timeout | Why |
|---|---|---|
| Website widget | chatbot setting, **30 min** by default (5–1440) | A web visit is short. |
| Website widget (hard cap) | **24 h** after start (`MAX_DURATION`) | A tab left open does not keep one session forever. |
| Slack | **4 h** | Threads pause naturally for hours. |
| WhatsApp | **24 h** | Matches Meta's 24-hour customer-service window. |
| Email | **7 days** | Email is slow by nature. *(Defined for later: email conversations currently run through Tickets, so no email chat session uses it.)* |
| Voice (future) | **10 min** | A call is one sitting. *(Not used: there is no voice channel yet.)* |
| Any chat in human takeover | at least **60 min** | Agents need time to research. |

Expiry is applied in three places, so it is prompt without depending on any one mechanism:

1. **Lazily**, when the session is next used: a widget GET, POST or stream, or an inbound channel message.
2. **When the dashboard looks**: the Chats page, the list API and the live stream each close due sessions.
3. **On a schedule**: `GET/POST /api/cron/sessions` with `Authorization: Bearer $CRON_SECRET`, meant to run every ~5 minutes. It also removes old rate-limit counters. *Nothing in the repo schedules it yet (no `vercel.json`) and it needs `CRON_SECRET`; without it, sessions still expire lazily when used and when the Chats page loads.*

Closing a session writes the reason and resolution, posts a friendly notice to the customer (for example *"This conversation was closed after 30 minutes of inactivity. Send a message any time to start a new one — we'll remember what we talked about."*), logs `SESSION_EXPIRED` or `SESSION_CLOSED` with the duration, and schedules the final summary and the customer-memory update.

### 5.3 Website widget sessions: security (fixes SEC-18)

- The first message returns a **secret session token** (32 random bytes, base64url). The widget keeps it in `localStorage` and sends it as the `x-assistdesk-session-token` header (or `?session=` for SSE, because EventSource cannot send headers).
- The server stores only `sha256("widget-session:" + token)`. A database leak does not reveal usable tokens, and the old guessable session id no longer grants access.
- Without a valid token the API reveals **nothing**: no transcript, no name, no email.
- An old token of a closed session can still read that ended conversation (read-only). Sending a message with it starts a new linked session and returns a new token.
- The widget also creates an anonymous **visitor id** (random UUID) per browser. This lets a returning visitor be recognised without any personal data, and it is the basis of the trust level in §6.3.
- Session starts are limited to 10 per chatbot and IP per hour.

### 5.4 Channel flows

| Channel | Conversation key | Customer identity | Notes |
|---|---|---|---|
| Website widget | session token | visitor id + typed name, email and phone (optional or required per chatbot) | End chat button; expiry warning 5 min before; new-conversation divider. |
| WhatsApp | sender's number (`wa_id`) | WhatsApp id = verified phone number | Signature-checked webhook; the reply is sent after the ack (`after()`); a failed delivery is logged and raises an alert. |
| Slack | DM channel, or channel + thread for @mentions | Slack user id (+ email with the `users:read.email` scope) | Same pipeline as WhatsApp. |
| Email | ticket (`[PREFIX-NUMBER]` in the subject) | sender address | Replies are **threaded** into their ticket (reopening it if needed), quoted text is stripped, Message-ID retries are ignored, and a reference is honoured only when the sender is the ticket's requester. The AI answer uses the whole thread plus the customer's memory. |

All channels share one pipeline: `resolveContact` → get/start session → rate limit → `appendSessionMessage` → AI reply with memory → deliver.

### 5.5 Human takeover and reply modes

- **Take over** or **any team reply** sets `ESCALATED`, pauses the AI and logs `HUMAN_TAKEOVER`. **Hand back to AI** logs `AI_RESUMED`.
- The chatbot's reply modes (always / when the team is offline / fallback after N seconds) and the **AI reply limit** still apply. When `maxAiMessages` is reached the chat becomes human-only and `AI_LIMIT_REACHED` is logged.
- For email: once a human has answered on a ticket, the AI no longer auto-answers follow-ups on that ticket.

---

## 6. How context and memory work

### 6.1 Three memory layers (FE-3, FE-2)

| Layer | What | When it is written | What the AI receives |
|---|---|---|---|
| 1. Session history | The last **12 messages** verbatim | Every message | As chat turns |
| 2. Rolling session summary | Everything older than the last 12 messages, condensed into ≤ 80 words | Background job, once 8+ new messages have gone past the window; **final** summary on close | `<conversation_summary>` block |
| 3. Customer memory | A profile (≤ 100 words) built from recent sessions on **all channels** and tickets, plus the **3 most recent other sessions** (their summary, or their last messages if no summary exists yet, so a switch carries over **immediately**), plus open tickets | On session close, and on "Summarise now" | `<customer_memory>` block |

Summaries and profiles are written **after the response is sent** (`next/server` `after()`), so customers never wait for them. If no model is available, an **extractive summary** is stored instead: the customer's asks and the last answer.

Knowledge retrieval also uses the context: a short follow-up ("and for gifts?") is searched together with the previous question.

### 6.2 Recognising the same customer (Unified Memory Buffer)

`resolveContact()` normalises every identifier. Emails are lower-cased. Phones are converted to E.164: `0300-1234567`, `+92 300 1234567` and WhatsApp's `923001234567` all become `+923001234567`, using `ASSISTDESK_DEFAULT_COUNTRY_CODE`, default 92. Then it:

- finds the Contact by **any** known identifier;
- **links** new identifiers to it (logged as `CHANNEL_LINKED`: "Linked WhatsApp to this customer");
- **merges** two Contacts when a new identifier proves they are one person. Sessions, tickets and events move over, and the merge is logged as `CONTACTS_MERGED`;
- is safe under concurrency (it retries on unique-constraint races).

### 6.3 Privacy: the trust level

Anyone can type someone else's email into a website chat box, so memory must not become a data leak. We protect it in code, not only in the prompt:

| Situation | Trust | What the AI gets |
|---|---|---|
| WhatsApp, Slack, email | **Verified**: the provider asserts the identity, and replies go back to that identity | Full memory; email and phone always **masked** (`a***@example.com`, `*********4567`) |
| Website, **same browser** as the customer (visitor id matches) | **Verified** | Same as above |
| Website, only a **typed** email or phone matched | **Unverified** | Memory with every identifier **redacted** in code (`[number hidden]`, `[email hidden]`, `[phone hidden]`), plus a note that the identity is not verified. Sessions from unverified visitors are **labelled** in memory as "may not be this customer". |

Additional rules:

- The prompt tells the AI never to read out contact details it was not asked for, and never to guess anything shown as hidden. All memory blocks are declared **data, not instructions** (prompt-injection defence).
- **Workspace switch:** Settings → *Cross-channel memory* turns layer 3 off entirely.
- **Right to be forgotten:** Contacts → *Forget this customer* (Manager+). It deletes the Contact, and optionally their conversations; otherwise the transcripts are anonymised. Tickets stay, unlinked.
- Staff can **edit or clear** a customer's memory (logged as `MEMORY_EDITED`).
- Reasoning models sometimes print their thinking. Only the tagged answer (`<summary>`, `<profile>`) is kept, and a reply that reads like thinking is rejected in favour of the extractive fallback.

---

## 7. Rate limiting (FE-6)

All limits live in PostgreSQL (`RateLimitBucket`, one atomic `INSERT … ON CONFLICT`). They are shared across instances and survive restarts. If the database is unreachable, the limiter **fails open** so it can never take the assistant down. Keys contain only **hashes** of IPs and emails. The SQL clock is `NOW() AT TIME ZONE 'UTC'`, so it is correct whatever the database time zone.

| Limit | Default | Response |
|---|---|---|
| Widget messages per **conversation** | chatbot setting, **10 / min** (1–120) | 429 + `Retry-After`, `RATE_LIMITED` event, dashboard alert |
| Widget messages per **IP** | 30 / min | 429 |
| Widget messages per **widget** (whole bot) | 600 / min | 429 |
| New widget sessions per chatbot and IP | 10 / hour | 429 |
| Widget attachment uploads per IP | 10 / min | 429 |
| WhatsApp/Slack messages per conversation | 20 / min | Messages dropped; the customer is told **once** per window |
| Inbound emails per integration | 60 / min | 429 (the provider retries later) |
| Failed logins per account / per IP | 5 / 30 per 10 min | 429 (replaces the in-memory limiter, SEC-30) |
| Sign-ups per IP | 5 / hour | 429 |
| "Summarise now", lead/webhook tests per user | 30 / min | 429 (the agent Playground is not rate-limited yet) |

The widget shows the server's "please wait N seconds" message and disables Send until the window passes.

---

## 8. Real-time updates (CI-1, PER-3)

- `appendSessionMessage()` is the **only** place messages are added. It updates the counters and the idle clock, then publishes an event on an in-process event bus.
- **Widget stream** `GET /api/widget/{id}/stream?token=…&session=…` emits `message` (new messages) and `session` (status, expiry, operators online).
- **Dashboard stream** `GET /api/chat-sessions/events` emits `changed`. The Chats page then re-fetches the list with its filters, debounced to 300 ms.
- Every stream **also polls the database every 2 s**, so on a multi-instance deployment (where the event bus is per instance) updates still arrive within about 2 s. Streams end after 55 s and EventSource reconnects automatically (serverless-friendly). After repeated failures the widget falls back to polling every 4 s and the dashboard every 15 s.
- Measured: a team reply appeared in the widget **2 ms** (API test) and **52 ms** (browser test) after it was posted.

---

## 9. What the team sees (dashboard)

- **Chats:**
  - Filters for Open / Human / Closed / All, channel and search (customer or message text), with a *Live* indicator.
  - Rows show "Returning" and "N conversations" badges.
  - The header shows a live *Expires in …*, or *Ended · reason · resolution*.
  - Composer hint: "Replying pauses the AI (human takeover)".
  - **Customer & context panel**:
    - customer identities and channels;
    - session policy and counters;
    - summary with a **Summarise now** button;
    - AI memory, with **"What the AI knows"** showing the exact block sent to the model;
    - other conversations, tickets and the activity timeline.
  - Deep links `?session=<id>` work for any conversation.
- **Contacts** (new sidebar item):
  - Searchable list with channel chips, conversation and ticket counts, and a memory badge.
  - Detail page with identities, an editable name, the AI memory card (edit or clear), the cross-channel conversation timeline, tickets, the activity log, and the danger zone (forget customer).
- **Chatbot settings:** *Conversation timeout (minutes)* and *Message rate limit (per minute)*.
- **Settings:** *Customer Memory → Cross-channel memory* switch.

---

## 10. API reference

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/widget/{id}/messages` | embed token + session token | Current (or ended) conversation of this visitor |
| `POST /api/widget/{id}/messages` | embed token (+ session token) | Send a message; returns `sessionToken` when a new session starts, plus `previousSession` |
| `DELETE /api/widget/{id}/session` | embed + session token | Customer ends the conversation |
| `GET /api/widget/{id}/stream` | `?token=&session=` | SSE for the widget |
| `GET /api/chat-sessions` | dashboard | List with `status`, `channel`, `q`, `contactId`, `include` |
| `GET /api/chat-sessions/events` | dashboard | SSE for the Chats page |
| `PATCH /api/chat-sessions/{id}` | dashboard | `ACTIVE` / `ESCALATED` / `CLOSED` (409 if already closed) |
| `POST /api/chat-sessions/{id}/messages` | dashboard | Team reply (takes over; delivered to WhatsApp/Slack) |
| `GET /api/chat-sessions/{id}/context` | dashboard | Contact, policy, memory, AI context, other sessions, tickets, events |
| `POST /api/chat-sessions/{id}/summary` | dashboard | Summarise now |
| `GET /api/contacts`, `GET/PATCH/DELETE /api/contacts/{id}` | dashboard (DELETE: Manager+) | Customers, memory edit, forget |
| `POST /api/integrations/email/inbound` | webhook secret | Email → ticket or threaded reply (`outcome`: created / threaded / duplicate) |
| `GET/POST /api/cron/sessions` | `Bearer CRON_SECRET` | Expire idle sessions, clean counters |

---

## 11. Requirement traceability

| Requirement | Where it is met |
|---|---|
| FE-1 create/maintain sessions | `session-lifecycle.ts` (`startSession`, `appendSessionMessage`, `closeSession`), `widget-session.ts`, `getOrStartChannelSession` |
| FE-2 cross-platform sync | `contacts.ts` (`resolveContact`, merge), `session-memory.ts` (`buildContactContext`), used by the widget, WhatsApp, Slack and email |
| FE-3 preserve context | 12-message history, rolling and final summaries, `buildRetrievalQuery` |
| FE-4 session history | `SessionEvent`, Chats filters and panel, Contacts timeline, `previousSessionId` chain |
| FE-5 expiration | `CHANNEL_IDLE_MINUTES`, `getExpiryReason`, lazy, page and cron expiry, notices |
| FE-6 rate limiting | `rate-limit.ts`, the limits in §7, `RATE_LIMITED` events and alerts |
| SRS event: allowed domain | The widget token is issued only for allowed domains (Module 1) and is checked on every call. 🟡 Refused origins get 403 but are not logged yet. |
| SRS event: append to buffer | `appendSessionMessage` |
| SRS event: context on channel switch | `CONTEXT_CARRIED` event plus the memory block |
| SRS event: 429 + log | `tooManyRequests` + `RATE_LIMITED` |
| SRS event: expiry/termination log | `SESSION_EXPIRED` / `SESSION_CLOSED` with reason, resolution and duration |
| SRS event: reply modes / AI limit | `decideWidgetReply`, `AI_LIMIT_REACHED` |
| PER-3 ≤ 1 s | SSE, measured 2–52 ms |
| CI-1 live updates | Widget and dashboard SSE with polling fallback |

---

## 12. Testing

- **Unit tests** (`tests/unit/sessions-and-memory.test.ts`, 31 cases; 78 in the whole suite, all passing):
  - expiry per channel, escalated minimum and hard cap;
  - resolution; tokens and hashing;
  - phone, email and visitor-id normalisation;
  - masking, redaction and trust;
  - transcript formatting, extractive summary and tagged-output extraction;
  - retrieval query;
  - email reference parsing, subject cleaning, quote stripping and Message-ID;
  - rate-limit helpers.
- **End-to-end** (scripted against a real dev server and database, 60 checks; recorded run with a script that was not kept; the same areas are now covered by `scripts/e2e/e2e-all.mjs`, 131/131 on 10 Oct). Run 2 passed **56/56**; later runs added the privacy checks, which passed:
  - session start with a hashed token;
  - no access without a token;
  - in-session recall ("what was my order number?" → **#1042**);
  - End chat, then resolution, background summary and customer memory;
  - a new linked session carries the context;
  - idle expiry with notice;
  - per-session 429 with `Retry-After` and log;
  - WhatsApp message from the same number → same Contact → reply mentions the kettle order → `CONTEXT_CARRIED`;
  - failed delivery logged;
  - email → ticket on the same Contact, then reply threaded and quotes stripped, retry deduplicated, a stranger's reference not threaded;
  - dashboard list and filters, context API across 3 channels, takeover, agent reply, close, 409 on reopen, `HUMAN_HANDLED`;
  - contacts search and timeline;
  - **SSE team reply in 2 ms**;
  - cron auth and expiry;
  - DB login lockout with hashed keys;
  - **impostor** (another browser typing the customer's email) gets no order number or phone, and the context shows redaction.
- **Browser check:**
  - Chats page and context panel;
  - Contacts list and detail;
  - chatbot fields; settings toggle (memory off → the AI context is empty);
  - widget: End chat, then new conversation with the divider, and the AI recalled "2–3 days" from the previous conversation's team reply.
- Note: on the free LLM tier, AI replies fall back to the knowledge-base answer when the provider's per-minute quota is used up. The fallback is logged as `FALLBACK`; it is not a Module 5 fault. For demos, give the agent its own API key or a Groq key.

---

## 13. Demo script (about 5 minutes, for the viva)

1. **Widget, FE-1/FE-3.** On the test site, open the widget, enter name, email `ali@example.com` and phone `0300-1234567`, and say *"My order #1042 for a blue kettle hasn't arrived."* Then ask *"What was my order number?"* → the AI answers **#1042**.
2. **Dashboard, CI-1.** In *Chats*, take over and reply. The reply appears in the widget instantly. Hand back to AI.
3. **End and resume, FE-5.** Click *End chat* in the widget. The session closes with a notice, and in *Chats* the context panel shows the final summary and customer memory. Send a new message: a divider appears, and the AI remembers the kettle order.
4. **Channel switch, FE-2.** From WhatsApp number `+92 300 1234567`, write *"Any update on my kettle?"* → the AI knows the earlier website chat. In *Contacts → Ali*, the timeline shows Website + WhatsApp, and "Memory used in a reply" appears in Activity.
5. **Email.** Send an email from `ali@example.com`: a ticket appears under the same contact. Reply to the AI email: it threads into the same ticket.
6. **Rate limit, FE-6.** Set the chatbot's rate limit to 2/min and send 3 messages quickly → *"Please wait … seconds"*, and a `RATE_LIMITED` alert appears.
7. **Privacy.** In a private window, type Ali's email and ask for the order number → it is refused. Open *What the AI knows* on that chat to show `[number hidden]`.
8. **Expiry.** Set the timeout to 5 min, or run `curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/sessions`. The chat shows *Timed out (idle)*.

---

## 14. Limitations and future work

- **Voice** channel (Module 3): only the policy exists. It needs a Deepgram/Vapi adapter calling the same pipeline.
- **Multi-instance real time:** the event bus is per instance, and other instances fall back to 2 s polling. Swap `realtime.ts` for Redis or Postgres `LISTEN/NOTIFY` when scaling out.
- **Unverified web identity:** mitigated by redaction and labelling. Stronger verification (email OTP before linking) is future work.
- Email sender addresses are trusted as-is (no SPF/DKIM check). AI replies still go only to the real address.
- A contact's first browser is the "trusted" one. A customer on a second device is treated as unverified until they use WhatsApp, Slack or email.
- The Contacts list shows anonymous visitors too (there is no "hide anonymous" filter yet), and memory can be edited by any team role.

## 15. File map

| Area | Files |
|---|---|
| Core | `src/lib/session-lifecycle.ts`, `src/lib/session-memory.ts`, `src/lib/contacts.ts`, `src/lib/rate-limit.ts`, `src/lib/realtime.ts` |
| Widget | `src/lib/widget-session.ts`, `src/lib/widget-conversation.ts`, `app/api/widget/[widgetId]/{messages,session,stream,attachments}`, `src/components/widget/chatbot-widget-client.tsx` |
| Channels | `src/lib/integrations/channel-inbound.ts`, `src/lib/integrations/slack.ts`, `app/api/integrations/{slack,whatsapp}/…`, `src/lib/email-ingestion.ts`, `src/lib/email-threading.ts`, `src/lib/ticket-workflow.ts` |
| AI | `src/lib/conversation-runtime.ts`, `src/lib/llm-runtime.ts` (memory blocks, retrieval query, `generateCompletion`) |
| Dashboard | `app/api/chat-sessions/**`, `app/api/contacts/**`, `app/api/cron/sessions`, `src/lib/chat-session-list.ts`, `src/lib/contact-list.ts`, `src/lib/contact-labels.ts`, `src/components/dashboard/{chats-workspace,contacts-workspace,contact-detail-workspace}.tsx`, `app/dashboard/{chats,contacts}/**` |
| Settings | `app/api/chatbots/route.ts`, `app/api/settings/route.ts`, chatbot configuration and settings workspaces |
| Auth | `src/lib/auth.ts` (DB login limiter), `app/api/auth/{login,signup}` |
| Tests | `tests/unit/sessions-and-memory.test.ts` |
