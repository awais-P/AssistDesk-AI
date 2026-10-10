# Module 8: Lead Generation System

> **Status:** about 92% implemented (30 Sep 2026). All five features work end to end on the website widget, WhatsApp and Slack, with signed webhooks, CSV export and a full lead database.
> **Owner (Proposal work split):** Ahmad Mujtaba Shahid · built with Muhammad Awais
> **Related:** [M5_SESSION_CONTEXT.md](M5_SESSION_CONTEXT.md) (customers, sessions and memory, which M8 builds on) · [CHANGELOG.md](CHANGELOG.md) · [ROADMAP.md](ROADMAP.md) · `VULNERABILITIES.md` (local)

---

## 1. What the module does

The Proposal and SRS define Module 8 as turning conversations into sales opportunities:

| ID | Feature | What we built |
|---|---|---|
| FE-1 | Customizable lead capture forms integrated within assistant conversations | A per-chatbot **form builder** (up to 8 fields, custom dropdowns, consent checkbox, texts, trigger). The widget shows it **inline in the chat**; the AI **pauses** until it is submitted or skipped, then answers the question it held back. |
| FE-2 | Automatically collect user information (name, email, contact details) | Details the customer already gave (pre-chat fields, typed in a message, earlier conversations, their WhatsApp number) prefill the form or **capture the lead without showing it**. Buying intent on WhatsApp/Slack creates a lead automatically. |
| FE-3 | Notify external channels when new leads are generated | Dashboard alert (bell), **email** to the team, and a **Slack** incoming-webhook message, with a "Send test" button. Every attempt is logged on the lead. |
| FE-4 | Export or forward lead data via webhooks or APIs | **Signed webhooks** (`lead.created`, `lead.updated`, `lead.status_changed`, `lead.deleted`), **3 retries** with backoff and a delivery log, manual retry, **CSV export**, and a JSON API. |
| FE-5 | Lead database for follow-up and marketing | **Leads page:** search, filters, sorting and pagination (SRS UI-4). **Lead detail:** status pipeline, owner, notes, timeline, conversation, score, deliveries. Marketing consent is recorded for campaigns. |

The SRS backend events are all met:

1. **Form detection and injection.** The trigger is detected, the inline card is injected and the AI pauses (`LEAD_FORM_SHOWN`).
2. **Submission.** The fields are validated (email format, required fields). A lead is created in PostgreSQL and **linked to the session and assistant**. The team is notified, and the **session context is updated** with the lead data.
3. **Webhook.** A JSON POST is sent to each configured URL, the delivery status is logged, and a failed send is **retried up to 3 times**.
4. **Leads KPI (FR-11.3).** The Overview's *Leads captured* card counts leads in the selected period, and how many are hot.

---

## 2. How it works

### 2.1 The lead lifecycle

```
 conversation ──► trigger? ──► known details cover the form? ──yes──► lead captured (AUTO)
     (M5)            │                       │ no
                     │                       ▼
                     │           inline form shown, AI paused
                     │               │               │
                     │            submit           skip / keeps typing
                     │               ▼               ▼
                     │        lead captured      no lead this conversation
                     │          (FORM)           (never asked again in it)
                     ▼
     WhatsApp/Slack buying intent + reachable customer ──► lead captured (AUTO)

 lead captured ──► score ─► timeline event ─► dashboard + email + Slack ─► webhooks (signed, retried)
                     └──► intent summary (background) ─► customer memory (M5)

 NEW ──► CONTACTED ──► QUALIFIED ──► CONVERTED            (LOST from any)
 └──────── "open" leads: a returning customer updates this lead instead of creating a new one
```

### 2.2 Triggers (FE-1)

| Trigger | Fires when |
|---|---|
| **When the visitor shows buying intent** (default) | The message asks about prices, quotes, plans, trials, demos, bulk orders, discounts or talking to sales, in English, Roman Urdu ("kitne ka", "qeemat") or Urdu ("قیمت"). Complaints ("refund", "where is my order") never count. |
| **After a number of messages** | The visitor has sent N messages (1–20). |
| **After the first message** | Right after the first message, before the AI answers it. |

The form is asked **at most once per conversation**, and never to a customer who already has an open lead.

### 2.3 What happens when the trigger fires

1. **Everything the form requires is already known** (pre-chat name/email, an email typed in chat, the customer's record): the lead is captured directly (source `AUTO`), and the AI answers normally. The customer is never asked for something they already told us.
2. **Otherwise** the widget shows the form, prefilled with what we know. The session's `leadState` becomes `PROMPTED`, and the AI waits:
   - **Submit:** fields are validated server-side (per-field errors). The lead is created or updated, the visitor is thanked by name ("Thanks, Ayesha! …"), and **the AI then answers the question it held back**.
   - **Skip** (if allowed): `SKIPPED`; the AI answers the held question.
   - **The visitor keeps typing instead:** this counts as a skip, and the AI answers the new message.
   - The form survives a page reload (the server remembers `PROMPTED`).

### 2.4 Automatic capture (FE-2)

- An **email or phone typed in any chat message** is detected and added to the customer's record, so it prefills the form and future leads.
- On **WhatsApp and Slack**, a message with buying intent from a reachable customer (WhatsApp always gives a verified phone number) creates or updates their lead, with channel WhatsApp and source "Detected in chat". Example: *"10 kettles kitne ka milega?"*.
- Admins can switch automatic capture off (Leads → Settings).

### 2.5 One lead per customer

Leads are matched on the M5 Contact, email or phone:

- A returning customer **updates their open lead** instead of creating a duplicate. Their details are merged, the event "Returned: …" is logged and `lead.updated` is sent.
- Once a lead is Converted or Lost, a new enquiry starts a new lead.
- The lead always joins the customer's Contact, using the visitor's browser id too. That keeps their conversations, tickets and memory together, and keeps them "verified" in M5 terms.

### 2.6 Score and temperature

The score (0–100) prioritises follow-up:

| Signal | Points |
|---|---|
| Reachable: email | +20 |
| Reachable: phone | +15 |
| Identified: name | +5 |
| Identified: company | +10 |
| Identified: each custom answer | +5 (up to 15) |
| Engaged: buying intent in the conversation | +20 |
| Engaged: 4+ customer messages | +5 |
| Engaged: 8+ customer messages | +5 more |
| Engaged: returning customer | +10 |
| Consent to marketing | +5 |

**Hot** is 70 or more, **warm** 40–69, **cold** below 40. The rule is explained on every lead page.

### 2.7 What the lead records (and what the AI knows)

- **Details:** name, email, phone and company in normalised form (E.164 phones, lower-case emails), plus custom answers, consent, source (lead form, detected in chat, added by team, AI assistant), channel, chatbot and website host.
- **Intent:** a one-line "Interested in…" summary written in the background from the conversation. If no model is available, the customer's own sentence is used.
- **Customer memory (M5):** gets a line like *"Sales lead (qualified) from Khan Traders: wants a quote for 50 kettles"*, so on any channel the AI knows it is talking to a prospect.

---

## 3. Notifications and webhooks

### 3.1 Team notifications (FE-3)

Configured in **Leads → Settings** (Admin):

- Up to 10 email recipients. Email uses the platform SMTP sender; if none is configured, the page says so and the failure is logged on the lead.
- A Slack incoming-webhook URL (stored encrypted, shown masked).
- Every new lead also raises a dashboard notification ("New hot lead: Ayesha Khan").
- The results (✓ Dashboard alert · ✗ email…) are written to the lead timeline. A failing channel raises a warning alert.

### 3.2 Webhooks (FE-4, SRS CI-3)

- Admins add endpoints (name, URL, events). The **signing secret is shown once**, and can be rotated.
- **Security:**
  - HTTPS is required in production.
  - Private and loopback addresses are refused (SSRF), and redirects are not followed.
  - Every request times out after 10 s.
  - For local testing only, `ASSISTDESK_ALLOW_PRIVATE_WEBHOOKS=true`.
- Each request carries:
  - `X-AssistDesk-Event`: e.g. `lead.created`.
  - `X-AssistDesk-Delivery`: a stable id, so receivers can ignore duplicates.
  - `X-AssistDesk-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.rawBody")>`. Receivers verify it and reject timestamps older than 5 minutes.
- **Retries:**
  - Attempt 1 is sent right away; retries follow after 30 s, 2 min and 10 min.
  - A delivery is marked FAILED after 4 attempts, which logs a lead timeline event and raises a dashboard alert.
  - Due retries are sent by `/api/cron/webhooks` (`CRON_SECRET`, meant to run every minute) and when the leads API is called (filter, sort or page changes on the Leads page). *Nothing in the repo schedules the cron yet (no `vercel.json`): set up Vercel Cron or another scheduler for automatic retries.*
  - "Retry" in the delivery log sends one more attempt right away.
- **Delivery log:** status, attempts, HTTP code, response excerpt, error, and the exact JSON payload.

Payload example (`lead.created`):

```jsonc
{
  "id": "cmun…",                     // delivery id (= X-AssistDesk-Delivery)
  "event": "lead.created",
  "createdAt": "2026-09-30T01:24:11.000Z",
  "workspace": { "id": "…", "name": "AssistDesk Demo Workspace" },
  "data": {
    "lead": { "id": "…", "name": "Ayesha Khan", "email": "ayesha.khan@example.com", "phone": "+923007654321",
              "company": "Khan Traders", "fields": [{ "key": "quantity", "label": "Quantity", "value": "50+" }],
              "intent": "Wants a quote for 50 electric kettles.", "status": "NEW", "score": 80, "temperature": "HOT",
              "source": "FORM", "channel": "WEB_WIDGET", "marketingConsent": true, "createdAt": "…", "updatedAt": "…" },
    "chatbot": { "id": "…", "name": "Website Support Bot" },
    "conversation": { "id": "…", "channel": "WEB_WIDGET" },
    "links": { "lead": "https://your-app/dashboard/leads/…" }
  }
}
```

`lead.deleted` carries only `{ lead: { id, email, phone }, deletedBy, deletedAt }`, so the CRM can delete its copy. This supports privacy requests.

### 3.3 Export and API

- **CSV export** (Manager+) of the current filtered list, with one column per custom field.
  - Excel-safe UTF-8 with a BOM, so Urdu names display correctly.
  - Formula injection is defused: cells starting with `= + - @` get a leading `'`, so phone numbers appear as `'+92…`.
  - Up to 5,000 rows.
- The same JSON the dashboard uses is available at `GET /api/leads`, behind the dashboard session. An API-key API is Module 11.

---

## 4. Dashboard

- **Leads** (sidebar):
  - Status pills with counts: All, Open, New, Contacted, Qualified, Converted, Lost.
  - Search across name, email, phone, company and intent; filters for source, channel, temperature, owner and date range. Everything is kept in the URL, so views can be shared.
  - Sortable columns (name, score, status, created, last activity) and pagination (25/50/100).
  - Add lead; Export CSV; Settings.
- **Lead detail:**
  - Status and owner selectors; inline edit of details.
  - Custom answers and consent; source, chatbot and host.
  - Score explanation; conversation excerpt with "Open in Chats" and "View customer".
  - Notes and a full activity timeline.
  - Webhook deliveries with "Send to webhooks again"; other leads of the same customer; delete (Manager+).
- **Leads → Settings:** notifications (emails, Slack, test, auto-capture) and webhooks (add, edit, activate, test, rotate secret, delivery log with payloads and retry, "How to verify" with a Node.js snippet).
- **Chatbot → Lead capture:** the form builder with a live preview.
- **Chats → Customer & context panel:** a Lead section showing the lead's status, temperature and intent, or a *Create lead* button, plus "Lead form shown / skipped".
- **Overview:** the *Leads captured* KPI (FR-11.3).

**Roles:**

| Role | Can do |
|---|---|
| All team members | View and work leads: status, owner, notes, edits, manual leads |
| Manager+ | Export CSV, delete leads, resend to webhooks |
| Admin+ | Notifications and webhooks (they send customer data out) |

---

## 5. Data model (migration `20260930090000_module8_leads`)

| Model / field | Purpose |
|---|---|
| **`Lead`** | Contact details, `fields` (custom answers), `intent`, `source`, `channel`, `status` (enum `LeadStatus`), `score`, `marketingConsent`, `pageHost`, `lastActivityAt`. Links to workspace, chatbot, session, contact and owner. |
| **`LeadEvent`** | Timeline: CREATED, UPDATED, STATUS_CHANGED, ASSIGNED, EDITED, NOTE, NOTIFIED / NOTIFY_FAILED, WEBHOOK_DELIVERED / WEBHOOK_FAILED / WEBHOOK_RESENT. |
| **`WebhookEndpoint`** | Name, URL, encrypted secret, events, active flag, last delivery and status. |
| **`WebhookDelivery`** | Event, payload, status (PENDING / RETRYING / SUCCESS / FAILED), attempts, `nextAttemptAt`, response status and body, error. |
| `Chatbot.leadForm` | The form config (JSON, sanitised by `parseLeadForm`). |
| `ChatSession.leadState` | PROMPTED / CAPTURED / SKIPPED for this conversation. |
| `WorkspaceSetting.leadNotifyEmails`, `leadSlackWebhookUrl` (encrypted), `autoCaptureLeads` | Notification and capture settings. |

Privacy: "Forget this customer" (M5) also deletes their leads. Deleting a single lead sends `lead.deleted`; forgetting a customer currently does **not** send `lead.deleted` for their leads, and webhook delivery logs keep the lead data.

---

## 6. API reference

| Method & path | Role | Purpose |
|---|---|---|
| `POST /api/widget/{id}/lead` | widget (embed + session token) | Submit `{values, consent}` or `{skip:true}`; returns messages, including the held AI answer |
| `GET /api/widget/{id}` / `…/messages` | widget | The public form definition / a pending `leadPrompt` |
| `GET /api/leads` | member | List with `q, status, source, channel, chatbotId, owner, temperature, from, to, sort, order, page, pageSize` |
| `POST /api/leads` | member | Manual lead from details or `{sessionId}` |
| `GET/PATCH/DELETE /api/leads/{id}` | member / DELETE Manager+ | Detail, update, delete |
| `POST /api/leads/{id}/notes` · `…/resend` | member · Manager+ | Note · re-send to webhooks |
| `GET /api/leads/export` | Manager+ | CSV |
| `GET/PATCH /api/leads/settings` · `POST …/test` | member / Admin | Notification and auto-capture settings · test |
| `GET/POST /api/webhooks`, `PATCH/DELETE /api/webhooks/{id}` | Admin | Endpoints |
| `POST /api/webhooks/{id}/test` · `…/rotate` · `GET …/deliveries` | Admin | Test, new secret, log |
| `POST /api/webhooks/deliveries/{id}/retry` | Admin | Manual retry |
| `GET/POST /api/cron/webhooks` | `Bearer CRON_SECRET` | Send due retries |

---

## 7. Testing

- **Unit tests** (`tests/unit/leads.test.ts`, 19 cases; 97 in the whole suite, all passing):
  - form sanitising, and that a form always has a contact field;
  - the public form view and the personalised thank-you;
  - validation (required, email/phone format, dropdown options, reachability);
  - intent detection in three languages, and complaints excluded;
  - triggers and asking only once;
  - contact extraction without false positives on order numbers or dates;
  - score and temperature; CSV quoting and formula defusing;
  - webhook signature verification, including replay protection.
- **End-to-end:** 72 checks against a real dev server, a PostgreSQL database and a **local receiver that verifies signatures** (recorded run with a script that was not kept; the same areas are now covered by `scripts/e2e/e2e-all.mjs`, 131/131 on 10 Oct).
  - Latest clean run: 71/72. The one miss was a garbled-query false failure from the PGlite test database; that check passed on its own afterwards, including the signed `lead.deleted` webhook.
  - Checks include:
    - the form on intent and the AI pausing; the form surviving a reload;
    - per-field validation; the thank-you by name and the held question answered;
    - normalised details, custom answers and consent;
    - links to session, chatbot and contact, and the score;
    - the session context updated;
    - `lead.created` delivered with a valid HMAC, and the payload carrying the delivery id;
    - retry on a flaky receiver, then success; giving up after 4 attempts, with the timeline event and an alert;
    - cron auth; the dashboard alert; the notification failure logged (no SMTP);
    - the intent summary; no duplicate for a returning customer;
    - skip, typing-on counting as a skip, and auto-capture with known details (no form);
    - an email typed in chat remembered;
    - a WhatsApp lead in Roman Urdu, and a WhatsApp complaint creating no lead;
    - list filters, search, sort and pagination;
    - a status change sent as `lead.status_changed`; invalid edits rejected; owner, notes and timeline;
    - detail with deliveries and conversation; CSV with custom columns;
    - a manual lead, refused without contact details;
    - Chats panel lead; memory line; the lead stays on the verified contact;
    - rotate secret; the delivery log;
    - role checks: an agent cannot export or manage webhooks.
- **Browser:**
  - the widget form (fill, consent, dropdown, submit → thanks → answer, input paused while open);
  - the Leads list; lead detail with the score breakdown and retries;
  - the settings page; the chatbot builder saved from the UI; the Overview KPI.
- **Note:** on the free AI tier the daily quota ran out during testing. AI answers then fall back to the knowledge-base reply, and intent summaries to the customer's own sentence. Both fallbacks are designed and logged.

---

## 8. Demo script (about 4 minutes)

1. **Chatbot → Lead capture:** enable it, trigger "buying intent", add a "Quantity" dropdown, set the consent text, save.
2. **Widget:** *"How much for 50 kettles? I need a quote."* → the form appears and the AI waits → fill in and submit → "Thanks, Ayesha!" → the AI answers.
3. **Leads:** the new hot lead appears with its score, source and "Interested in". Open it to see the timeline (captured, team notified, sent to CRM).
4. **Leads → Settings → Webhooks:** show the delivery log with the signed payload. Point the webhook at a failing URL and show the retries and the final alert.
5. **WhatsApp:** *"10 kettles kitne ka milega?"* → an automatic lead with the phone number.
6. **Follow-up:** set the status to Qualified (a webhook fires), assign an owner, add a note, export CSV.
7. **Overview:** the *Leads captured* KPI.

---

## 9. Limitations and future work

- Intent detection for the lead form is rule-based (AI-14). Since Module 2, agents with actions can also capture leads themselves with the `capture_lead` action.
- There is no API-key API for external systems yet (Module 11). Webhooks and CSV cover FE-4 today.
- Email notifications need platform SMTP (`ASSISTDESK_SMTP_*`).
- The webhook DNS-rebinding window is shared with SEC-28 (SEC-33).
- Status counts are workspace totals (UI-41).
- Parallel-request behaviour was verified only sequentially: the PGlite test DB cannot run concurrent connections (OPS-10).

## 10. File map

| Area | Files |
|---|---|
| Core | `src/lib/lead-form.ts` (pure: form, validation, intent, extraction, score), `src/lib/leads.ts` (capture, merge, notify, intent, update), `src/lib/lead-list.ts` (queries, CSV), `src/lib/webhooks.ts` (sign, deliver, retry), `src/lib/webhook-admin.ts`, `src/lib/identity.ts` |
| Widget | `app/api/widget/[widgetId]/lead/route.ts`, `…/messages/route.ts` (trigger, AI pause), `src/lib/widget-conversation.ts` (`respondToVisitor`), `src/components/widget/chatbot-widget-client.tsx` (inline form) |
| Channels | `src/lib/integrations/channel-inbound.ts` (auto-capture on WhatsApp/Slack) |
| APIs | `app/api/leads/**`, `app/api/webhooks/**`, `app/api/cron/webhooks`, `app/api/chatbots/route.ts` (`leadForm`) |
| UI | `app/dashboard/leads/**`, `src/components/dashboard/{leads-workspace,lead-detail-workspace,lead-settings-workspace,lead-form-builder}.tsx`, `src/lib/lead-labels.ts`, `src/lib/lead-detail.ts`, Chats panel, Overview KPI |
| Tests | `tests/unit/leads.test.ts` |
