# Module 9: Support Escalation

> **Status:** about 88% implemented (15 Nov 2026). Automatic escalation on every channel (website, WhatsApp, Slack, email), sentiment triggers in English, Roman Urdu and Urdu, an AI hand-over brief, a team queue with accept / assign / resolve, a response-time SLA with alerts, and a full escalation log with CSV export.
> **Owner (Proposal work split):** Muhammad Awais · with Ahmad Mujtaba Shahid
> **Related:** [M5_SESSION_CONTEXT.md](M5_SESSION_CONTEXT.md) (sessions, take over / hand back, customer memory) · [M2_AGENTIC_TOOLS.md](M2_AGENTIC_TOOLS.md) (the AI's `escalate_to_human` action) · [CHANGELOG.md](CHANGELOG.md) · [ROADMAP.md](ROADMAP.md) · `VULNERABILITIES.md` (local)

---

## 1. What the module does

The SRS lists five features for Module 9:

| ID | Feature (SRS) | What we built |
|---|---|---|
| FE-1 | Automatically escalate complex or sensitive conversations to human support agents | Every customer message is checked **before the AI answers**. Four triggers: an explicit request for a person, a **sensitive topic** (legal threat, payment dispute, fraud / hacked account, cancellation, and self-harm as *urgent*), the workspace's **own trigger phrases**, and **negative sentiment**. The AI can also hand over by itself (`escalate_to_human`, M2), and a failed action hands over automatically. Works on the website widget, WhatsApp, Slack and **email tickets**. |
| FE-2 | Context-aware hand-off: a summary of previous chats and the live transcript | When a conversation is escalated, the AI writes a **hand-over brief** (Issue, Tried so far, Mood, Customer history, Next step) from the live transcript **and the customer's earlier conversations and tickets on every channel** (M5 memory). Without a reachable model the brief is built from the messages. *The "live transcript of the current voice call" part waits for the voice channel (M6).* |
| FE-3 | Configure sentiment triggers that initiate escalation on predefined conditions | **Escalations → Settings** (Admin): switch each trigger on or off, set the **sentiment threshold** (-0.95 … -0.1), add up to 30 trigger phrases, set the **response time (SLA)**. A single angry message *or* frustration building over three messages escalates. |
| FE-5 | Provide conversation context to human agents during handoff | The **Escalations** queue and a **banner in Chats** show why the conversation was escalated, the priority, the brief and the deadline, with **Accept** and a link to the conversation. The Chats context panel (M5) still shows the customer, their memory, past sessions, tickets and leads. |
| FE-6 | Maintain logs of escalated conversations for review and improvement | Every escalation is stored with trigger, reason, sentiment, priority, owner, times (created / accepted / resolved), outcome and note. Queue / Mine / In progress / Resolved / All views, **CSV export**, 30-day figures (time to accept, % within SLA, reasons breakdown), session timeline events, and the M4 *Improve* page's escalation reasons. |

The SRS backend flow is met end to end:

1. **Trigger.** A rule fires (or the AI hands over, or a team member takes over). An `Escalation` row is created, the conversation status becomes `ESCALATED`, the AI stops replying, and the customer is told a person will reply.
2. **Hand-off summary.** The brief is written in the background and appears in the queue and in Chats.
3. **Accept from the queue.** A team member accepts (or a manager assigns). The customer sees "*Sana joined the conversation*".
4. **Resolve.** Hand back to the AI, close the conversation, or keep it with the team. Optionally the customer is **kept with the team** for future conversations. Everything is logged.

---

## 2. How it works

### 2.1 The escalation lifecycle

```
 customer message ──► trigger check ──no──► AI answers (M2 / M10)
  (any channel)           │ yes
                          ▼
          Escalation PENDING  ── conversation ESCALATED, AI paused,
          (priority, reason,      customer told, team alerted,
           SLA deadline)          hand-over brief written
                          │
       accept / assign / team member replies
                          ▼
                Escalation ACCEPTED  ──(no one accepts in time)──► SLA breached: alert
                          │
            resolve: HANDED_BACK │ CLOSED │ RESOLVED (+ keep customer with team)
                          ▼
                Escalation RESOLVED  ── AI resumes / conversation closed / stays with people
```

A conversation or ticket has **at most one open escalation**. A second trigger reuses it and raises its priority if the new trigger is more serious. The open check runs inside a transaction that **locks the conversation (or ticket) row** (`SELECT … FOR UPDATE`), so two triggers arriving together cannot open two escalations.

### 2.2 Where the checks run

| Path | What happens |
|---|---|
| Website widget (`respondToVisitor`) | The trigger check runs on the visitor's message before the reply decision. If it fires, the widget gets the hand-over notice instead of an AI reply. |
| WhatsApp / Slack (`channel-inbound.ts`) | Same check; the notice is delivered on the channel. |
| Email tickets (`processIncomingTicket`) | Subject and body are checked once (the subject is not counted twice when the body repeats it). An escalated ticket gets an internal note and a **raised priority**, and the **AI auto-reply is skipped**. Follow-ups are not answered by the AI while it is escalated. "Please have someone call me" alone does not escalate an email. |
| The AI (`escalate_to_human`, M2) | Trigger `AI_TOOL` with the AI's reason; a failed action with *hand over on failure* gives `TOOL_FAILURE` (high priority). |
| The team (Chats) | **Take over** opens an escalation already accepted by that person (`MANUAL`, no SLA). **Replying** does the same, or accepts the waiting escalation. **Hand back** resolves it as `HANDED_BACK`. **Close** resolves it as `CLOSED`. |
| Session expiry (M5) | `closeSession` resolves any open escalation of the conversation, so nothing stays open on a closed chat. |

Every customer message also gets its **sentiment score stored** (`ChatMessage.sentiment`), even when nothing fires; the next messages use it to detect building frustration.

### 2.3 The triggers (FE-1, FE-3)

Checked in this order; the first match wins:

| # | Trigger | When | Priority |
|---|---|---|---|
| 1 | `CUSTOMER_FLAGGED` | The customer was **kept with the team** when an earlier escalation was resolved (`Contact.aiPaused`) | Medium |
| 2 | `KEYWORD` (sensitive topic) | Safety / self-harm, legal action, payment dispute, fraud or security, cancellation, in English, Roman Urdu and Urdu | Urgent (safety), High, Medium (cancellation) |
| 3 | `KEYWORD` (own phrase) | One of the workspace's trigger phrases, as whole words | High |
| 4 | `HUMAN_REQUEST` | "Can I talk to a human", "I want a manager", "kisi insaan se baat karwao", "انسان سے بات" … but not "are you a real person?" | Medium, or High if the message is also very negative |
| 5 | `SENTIMENT` | One message at or below the threshold, **or** three negative messages in a row averaging near the threshold | High at -0.75 or below, otherwise Medium |

Plus `AI_TOOL`, `TOOL_FAILURE` and `MANUAL` from the paths above.

### 2.4 Sentiment scoring

`scoreSentiment` (`src/lib/escalation-triggers.ts`) is a deterministic lexicon scorer, so it is fast, free, runs on every message and is fully unit-tested:

- word weights from -3 to +3 for English, Roman Urdu and Urdu, plus phrases ("fed up", "rip off", "still waiting", "pagal bana rahe", "thank you" …);
- **negation** ("not happy", "acha nahi") within three words before or two after flips and softens the word;
- **intensifiers** ("very", "bohat", "بہت") strengthen it;
- **shouting** (`!!`, several CAPITALISED words) makes a negative message more negative;
- the total is squashed to -1 … +1 (`score = total / (|total| + 3)`).

Why not ask the LLM? It would add a model call (and cost, and seconds) to *every* message, and it fails when the free model quota runs out, which is exactly when customers get frustrated. The AI is still used where it adds value: deciding to hand over by itself, and writing the brief.

### 2.5 The hand-over brief (FE-2, FE-5)

`generateEscalationSummary` (`src/lib/escalation-summary.ts`) runs in the background right after the escalation opens:

- input: the last 40 messages (or the ticket thread without internal notes), the escalation reason, and `buildContactContext` (the customer's other recent sessions, open tickets and lead from every channel, M5);
- the agent's own model (or the managed chain) writes five labelled lines in at most 90 words, inside `<brief>` tags;
- if no model answers, a brief is assembled from the messages: first and latest customer message, the last answer, the mood from the sentiment score and the reason. The team never starts from nothing.

The brief can be **rewritten** from the queue.

### 2.6 Response time (SLA)

Each automatic escalation gets `slaDueAt = created + SLA minutes` (default 15). `checkEscalationSla` runs **every minute inside the server** (`instrumentation.ts`) and from `/api/cron/sessions`. It marks escalations still waiting past the deadline (`slaBreachedAt`, once), raises an **error-level alert** in the bell, and adds a timeline event. The queue shows "Accept within 6 min" / "Overdue by 3 min" and highlights overdue cards.

### 2.7 Notifications

| Type | When |
|---|---|
| `ESCALATION_CREATED` | A new automatic escalation (warning; error when urgent). Links to the escalation. |
| `ESCALATION_ASSIGNED` | A manager assigned it to someone else. |
| `ESCALATION_SLA_BREACHED` | No one accepted it in time. |

Session timeline events: `HUMAN_TAKEOVER` (kept, so M4 analytics and M5 resolution still work), `ESCALATION_ACCEPTED`, `ESCALATION_ASSIGNED`, `ESCALATION_RESOLVED`, `ESCALATION_SLA_BREACHED`, `AI_RESUMED`.

---

## 3. Admin screens and roles

**Escalations** (sidebar → Main, after Chats):

- stat tiles: Waiting, In progress, Overdue, Time to accept (30-day average), Within SLA (30 days), and the reasons breakdown;
- views: **Queue** (most urgent, then longest waiting first), **Mine**, **In progress**, **Resolved**, **All**;
- each card: priority, status, channel, trigger, mood, customer, reason, deadline, owner, the brief, and the actions;
- **Export CSV** of the current view (spreadsheet-formula safe); refreshes every 15 seconds; `?id=` deep links from notifications.

**Escalations → Settings**: the triggers, threshold slider, trigger phrases and SLA (Admin only; others see the settings read-only).

**Chats**: a banner on an escalated conversation with the reason, priority, owner, brief, **Accept** and **Details**.

| Action | Agent | Manager | Admin |
|---|---|---|---|
| See the queue, export CSV | ✅ | ✅ | ✅ |
| Accept a waiting escalation | ✅ | ✅ | ✅ |
| Take one over from a colleague | ✗ | ✅ | ✅ |
| Assign to a team member | ✗ | ✅ | ✅ |
| Resolve | own / unassigned | ✅ | ✅ |
| Change escalation settings | ✗ | ✗ | ✅ |

---

## 4. Data model (migration `20261115090000_module9_escalation`)

- **`Escalation`**: `workspaceId`, `sessionId?`, `ticketId?`, `contactId?`, `channel`, `trigger`, `reason`, `sentimentScore?`, `priority` (LOW…URGENT), `status` (PENDING / ACCEPTED / RESOLVED), `summary?`, `summaryGeneratedAt?`, `assigneeId?`, `acceptedAt?`, `resolvedAt?`, `resolvedById?`, `resolution?` (HANDED_BACK / CLOSED / RESOLVED), `resolutionNote?`, `slaDueAt?`, `slaBreachedAt?`. Indexed by workspace + status + time, session, ticket, contact and assignee.
- **`WorkspaceSetting`**: `escalationEnabled`, `escalationSentimentEnabled`, `escalationSentimentThreshold` (-0.5), `escalationOnHumanRequest`, `escalationSensitiveTopics`, `escalationKeywords[]`, `escalationSlaMinutes` (15).
- **`Contact.aiPaused`**: the customer is kept with the team.
- **`ChatMessage.sentiment`**: the score of each customer message.

Apply with `npx prisma migrate deploy` (the dev database needs it once).

---

## 5. API reference

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/escalations?view=queue\|mine\|in_progress\|resolved\|all` | any member | List + stats + team members |
| GET | `/api/escalations?view=…&format=csv` | any member | CSV download |
| GET | `/api/escalations/[id]` | any member | One escalation |
| PATCH | `/api/escalations/[id]` `{action:"accept", force?}` | member; `force` Manager | Accept / take over |
| PATCH | `/api/escalations/[id]` `{action:"assign", assigneeId}` | Manager | Assign |
| PATCH | `/api/escalations/[id]` `{action:"resolve", outcome, note?, keepWithTeam?}` | owner or Manager | Resolve |
| PATCH | `/api/escalations/[id]` `{action:"summarize"}` | any member | Rewrite the brief |
| GET / PATCH | `/api/escalations/settings` | GET any, PATCH Admin | Escalation settings |
| PATCH | `/api/chat-sessions/[id]` `{status}` | member | Take over / hand back / close (now through escalations) |
| GET | `/api/chat-sessions/[id]/context` | member | Now includes `escalation` for the Chats banner |

Errors: 400 invalid input, 403 role, 404 other workspace or unknown, 409 already resolved / someone else is handling it / conversation ended.

---

## 6. Testing

| Level | File | IDs | What |
|---|---|---|---|
| Unit | `tests/unit/escalation.test.ts` | UT-50 (8), UT-51 (5), UT-52 (10), UT-53 (7) | Sentiment in three languages with negation, intensifiers and shouting; requests for a person (and not "are you a person?"); sensitive topics and phrases; the decision order, settings switches and threshold; SLA deadline; stats, CSV formula defusing, settings validation, customer notices, the fallback brief |
| Integration (real DB) | `tests/integration/escalation.int.ts` | IT-19 (12), IT-20 (5) | Request for a person → queue, AI paused, customer told, SLA set; sentiment stored; frustration over three messages; one open escalation and priority raise; two triggers at once; accept / take over; assign; hand back; close resolves; customer kept with the team; settings off; SLA breach flagged once; angry email → high priority, note, no AI reply; calm email; no AI on escalated follow-ups; AI brief; fallback brief |
| Integration (routes + roles) | `tests/integration/escalation-api.int.ts` | IT-21 (9) | Queue with stats; accept / 409 / force needs Manager; assign needs Manager; resolve own only, outcome validated, close ends the chat; other workspace 404; settings Admin-only and validated; CSV; Chats take over / hand back; reply accepts |
| Integration (existing) | `tests/integration/tools.int.ts` | IT-02.09 | The AI's hand-over now creates a queued escalation |
| Browser | `tests/ui/escalations.spec.ts` | UI-ESC-01…04 | Visitor asks for a person → notice in the widget → card in the queue with brief and deadline; accept and hand back; settings saved; CSV |

Results on 15 Nov 2026: unit 30/30 (whole suite 273), integration 26 new + all existing (IT-12.03 caught a double-counted email subject, fixed), browser UI-ESC 4/4 plus UI-CHT-01…03 and UI-WID-06 re-run green.

Run: `npx vitest run tests/unit/escalation.test.ts` · `npx vitest run --config vitest.integration.config.mts tests/integration/escalation*.int.ts` · `npx playwright test -g "UI-ESC"`.

---

## 7. Demo script (about 4 minutes)

1. **Escalations → Settings:** show the triggers, move the threshold, add the phrase "warranty claim", SLA 15 minutes.
2. **Widget:** *"This is the worst service, I've been waiting a week!!"* → the visitor is told a team member will reply; no AI answer.
3. **Bell:** "High priority escalation: …". Open **Escalations**: the card with *Negative sentiment*, mood, "Accept within 15 min" and the AI brief.
4. **Accept** → the widget shows "*Sana joined the conversation*". Open the conversation: the Chats banner; reply as the team.
5. **Resolve** → *Hand back to the AI* with a note → the AI answers the visitor again.
6. **WhatsApp / Roman Urdu:** *"kisi insaan se baat karwao"* → escalated as *Asked for a person*.
7. **Email:** send *"You charged twice on my card, I want a chargeback"* → the ticket is High priority with an internal note and no AI reply; it is in the queue.
8. **Resolved** tab, the 30-day figures, **Export CSV**.

---

## 8. Limitations and future work

- **Voice (FE-2):** the brief cannot include a live call transcript until the voice channel exists (M6).
- The sentiment scorer is lexicon-based. It handles the three languages and common phrasing, but not sarcasm or every spelling of Roman Urdu. The threshold and trigger phrases let a business tune it, and the AI can still hand over on its own judgement.
- Queues are per workspace; there is no routing to teams or skills, and no round-robin auto-assignment yet.
- Notifications are in-app (bell); email/Slack alerts for escalations reuse nothing from M8 yet.
- The concurrency test runs on the PGlite test database, which serialises connections, so it proves the logic but not the row lock under real parallel load (same note as OPS-10). The `FOR UPDATE` lock is standard PostgreSQL behaviour.
- The SLA check runs in the server process; with several server instances each runs it, which is safe (a breach is flagged once) but redundant.

## 9. File map

| Area | Files |
|---|---|
| Triggers (pure) | `src/lib/escalation-triggers.ts` (sentiment, request for a person, sensitive topics, phrases, decision, SLA) |
| Service | `src/lib/escalation.ts` (open / accept / assign / resolve with row locks, inbound and ticket checks, SLA checker, customer notices) |
| Brief | `src/lib/escalation-summary.ts` |
| Queue, stats, CSV, settings | `src/lib/escalation-queries.ts` |
| Wiring | `src/lib/widget-conversation.ts`, `src/lib/integrations/channel-inbound.ts`, `src/lib/ticket-workflow.ts`, `src/lib/tools/builtin-tools.ts` (`escalate_to_human`), `src/lib/session-lifecycle.ts` (`closeSession`), `app/api/chat-sessions/[id]/route.ts`, `…/messages/route.ts`, `…/context/route.ts`, `instrumentation.ts`, `app/api/cron/sessions/route.ts` |
| APIs | `app/api/escalations/route.ts`, `app/api/escalations/[id]/route.ts`, `app/api/escalations/settings/route.ts` |
| UI | `app/dashboard/escalations/**`, `src/components/dashboard/escalations-workspace.tsx`, `escalation-settings-workspace.tsx`, Chats banner in `chats-workspace.tsx`, sidebar entry in `dashboard-config.ts` / `dashboard-sidebar.tsx` |
| Data | `prisma/schema.prisma`, `prisma/migrations/20261115090000_module9_escalation/` |
| Tests | `tests/unit/escalation.test.ts`, `tests/integration/escalation.int.ts`, `tests/integration/escalation-api.int.ts`, `tests/ui/escalations.spec.ts` |
