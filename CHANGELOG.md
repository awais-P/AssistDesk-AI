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
