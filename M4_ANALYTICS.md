# Module 4: Monitoring & Analytics

> **Status:** about 90% implemented (30 Sep 2026). The analytics dashboard of mock-up M-11 (FR-11.1–11.7), reports, improvement areas, transcripts and exports all work from real data. The one missing piece is tool-action analytics, which comes when Module 2 adds tools.
> **Owner (Proposal work split):** Muhammad Awais (Ahmad: tests)
> **Related:** [M5_SESSION_CONTEXT.md](M5_SESSION_CONTEXT.md) (sessions and resolutions) · [M8_LEAD_GENERATION.md](M8_LEAD_GENERATION.md) (leads) · [CHANGELOG.md](CHANGELOG.md) · [ROADMAP.md](ROADMAP.md)

---

## 1. What the module does

| ID | Proposal / SRS feature | What we built |
|---|---|---|
| FE-1 | Track conversations and interaction patterns to evaluate assistant performance | An **analytics store** (`AiInteraction`) with one row per AI answer on every channel (question, response time, tokens, model, confidence, whether it came from the knowledge base or was a fallback). It is combined with the M5 session outcomes into volume by day and channel, a weekday × hour activity heatmap, engagement, escalation and first-response metrics, and per-agent performance. |
| FE-2 | Store transcripts for analysis and quality assurance | Every message is stored (M5). Staff can download any transcript as text or JSON, including the customer's 👍/👎. The QA lists (unhelpful replies, escalations, unanswered) link straight to the conversation and its transcript. |
| FE-3 | Dashboard with response time, conversation volume, engagement rate | **Analytics → Overview:** the four FR-11 KPI cards, a 24-hour latency line chart, a conversation-volume chart, the resolution mix, a channels table, recent interactions, agent performance, and comparison with the previous period. |
| FE-4 | Reports on customer behaviour and frequently asked questions | **Analytics → Reports:** FAQ clusters (grouped by meaning when an embedding model is configured, otherwise by wording), customer behaviour (new vs returning, busiest day, peak hours, channel mix, heatmap), leads and tickets, and CSV exports. |
| FE-5 | Identify improvement areas for training | **Analytics → Improve:** knowledge gaps (questions answered without knowledge or with a fallback), with **Add answer to knowledge base**; replies customers rated 👎, with their comments; why conversations went to a human; and unanswered conversations. |
| M6 FE-3 (bonus) | Feedback loop | 👍/👎 on every AI reply in the widget, with an optional "what was missing?" note. It feeds the helpful rate and the Improve tab. |

### Mock-up M-11 (SRS Table 2.11)

| FR | Requirement | Implementation |
|---|---|---|
| FR-11.1 | Average AI response time (ms) for the period | Average and p95 of `AiInteraction.latencyMs`, with the change vs the previous period |
| FR-11.2 | Automation rate = AI-resolved / total × 100 | Conversations finished in the period with resolution `AI_RESOLVED`, divided by all finished conversations (M5 resolutions). Open conversations are not counted yet. |
| FR-11.3 | Leads captured in the period | M8 leads created in the period, plus how many are hot |
| FR-11.4 | Live sessions, refreshed in real time, zero shown | Active and with-team sessions, polled every 15 s (`/api/analytics/live`) |
| FR-11.5 | 24-hour latency line chart, HH:MM axis, hover tooltips | Hourly average and p95 for the last 24 hours in the workspace time zone. Empty hours are gaps, not zeros. |
| FR-11.6 | Recent interactions: customer, channel, status, duration, newest first; AI Resolved green, Escalated amber | 15 latest conversations with the status (AI resolved / Escalated / Unanswered / Active / With team) and the duration from first to last message |
| FR-11.7 | Channel icons | The same icons as the rest of the dashboard (globe, WhatsApp, Slack, envelope, microphone) |

The SRS backend events are met:

- **Latency recorded per AI call:** a timestamp at query and at reply, persisted to the analytics store.
- **Interaction record on session close:** channel, resolution, duration and an anonymised customer id in exports.
- **Dashboard aggregation:** KPIs, the chart and the table are aggregated on load and whenever a filter changes.

---

## 2. How it works

```
 customer message ──► AI reply (M1/M5/M8 pipeline)
                         │
                         ├─► ChatMessage (transcript, M5)
                         └─► AiInteraction {question, latencyMs, tokens, model, confidence,
                                            grounded, usedFallback, sourceIds, channel}
 widget 👍/👎 ─────────► MessageFeedback {rating, comment}
 session closes ───────► ChatSession.resolution / closedReason (M5)
 leads ────────────────► Lead (M8)

 src/lib/analytics.ts ── loadAnalyticsDashboard / loadAnalyticsReports / loadImprovementAreas
        (range + channel filter, workspace time zone, previous-period comparison)
        └── src/lib/analytics-math.ts (pure: percentiles, time buckets, heatmap, FAQ clustering)
```

- **What counts as "grounded":** at least one knowledge passage met the agent's confidence threshold (M10). A fallback means the LLM was unavailable and the knowledge-base answer was used.
- **Time zone:** buckets, days and the heatmap use the workspace time zone (Settings, default Asia/Karachi).
- **Ranges:** 24 h / 7 d / 30 d / 90 d / custom (max 180 days), optionally filtered by channel. Every KPI is compared with the previous period of the same length.
- **FAQ clustering:**
  - Customer questions from the period (latest 1,500) are grouped greedily.
  - Two questions join when their content words overlap (Jaccard ≥ 0.5), when a short question is fully contained in a longer one, or, when an embedding model is configured, when their meaning is close (cosine ≥ 0.82, cached for 10 minutes).
  - Content words are filler-free and lightly stemmed ("deliver" = "delivery").
  - Each group shows its most common wording, count, share, answered-from-knowledge rate, channels and other wordings.
- **Privacy:**
  - Analytics rows are deleted with their conversation or ticket, so "Forget this customer" removes them too.
  - Exports anonymise customers ("AK · 1F3C").
  - Transcripts and the Improve tab are for signed-in staff only.

---

## 3. Dashboard pages

- **Analytics** is a new sidebar item. The old **Reports** page (ticket reports) is still available and linked.
- **Overview (FE-3):**
  - KPI cards: FR-11.1–11.4.
  - Secondary metrics: conversations (chat + email tickets), engagement rate, escalation rate, answered from knowledge, fallback rate, helpful rate, first response time, conversation length, returning customers.
  - 24-hour latency chart; daily volume by channel; resolution mix; channels table; recent interactions (open in Chats, download transcript); agent performance.
  - Export interactions and conversations as CSV (Manager+).
- **Reports (FE-4):**
  - FAQ list, with filter and sort, share bars, answered badges, other wordings, and "Teach the assistant →".
  - Customer behaviour (tiles, busiest day, peak hours, channel mix, heatmap with a table view).
  - Leads funnel and sources; tickets by status, source and priority.
  - Export FAQ.
- **Improve (FE-5):** a summary strip, then:
  - **Knowledge gaps:** Add answer to knowledge base (saved as a text source `Q:/A:`, and the questions are marked handled) · Mark as handled (with undo).
  - **Unhelpful replies:** question, answer and comment, with a link to the conversation and transcript.
  - **Escalation reasons:** the customer's last message before a human took over, grouped.
  - **Unanswered conversations.**

**Roles:** everyone on the team can view analytics. **Manager+** can export CSV and mark or teach knowledge gaps, the same role that manages the knowledge base.

---

## 4. Data model (migration `20260930150000_module4_analytics`)

| Model | Fields |
|---|---|
| **`AiInteraction`** | workspace, agent, chatbot, session or ticket, `messageId` (the AI's ChatMessage), channel, `question`, `latencyMs`, `tokens`, `model`, `provider`, `confidence`, `grounded`, `usedFallback`, `sourceIds`, `reviewedAt` / `reviewedBy` (FE-5), `createdAt`. Indexed by workspace + time (+ grounded). |
| **`MessageFeedback`** | workspace, `messageId` (unique), session, `rating` (1 / -1), `comment`. |

The rows are written in `conversation-runtime.ts` (widget, WhatsApp, Slack) and `ticket-workflow.ts` (email). Playground tests are **not** recorded, so the numbers reflect real customers.

## 5. API

| Method & path | Role | Purpose |
|---|---|---|
| `GET /api/analytics?range=&from=&to=&channel=` | member | Dashboard data (KPIs, changes, latency24h, volume, channels, resolutions, heatmap, recent, agents) |
| `GET /api/analytics/live` | member | Live sessions now (FR-11.4 polling) |
| `GET /api/analytics/reports` | member | FAQ clusters, behaviour, leads, tickets |
| `GET /api/analytics/improvements` | member | Knowledge gaps, unhelpful replies, escalations, unanswered |
| `POST /api/analytics/interactions/review {ids, reviewed}` | Manager+ | Mark knowledge-gap questions handled (or undo) |
| `GET /api/analytics/export?type=interactions\|conversations\|faq` | Manager+ | CSV (anonymised) |
| `GET /api/chat-sessions/{id}/transcript[?format=json]` | member | Transcript download |
| `POST /api/widget/{id}/feedback {messageId, rating: 1\|-1\|0, comment?}` | widget visitor | 👍/👎 on their own AI replies |

## 6. Testing

- **Unit tests** (`tests/unit/analytics.test.ts`, 16 cases):
  - percentiles, automation rate, deltas, FR-11.6 status mapping, anonymisation;
  - time-zone parts (UTC+5 day rollover), 24 hourly buckets with gaps, heatmap, date keys;
  - stemming; FAQ clustering by wording, by containment and by vectors;
  - range parsing (default, custom cap, future dates, invalid input).
- **End-to-end** (43 checks against the dev server, generating real traffic):
  - analytics rows recorded with links, and grounded vs unanswered distinguished;
  - 👍/👎 saved and restored on reload; another visitor's message and user messages can't be rated;
  - AI-resolved, human-handled and unanswered endings;
  - every FR-11 KPI checked against the database (automation rate recomputed independently);
  - 24 hourly buckets; recent interactions order, status and duration; resolution mix; volume;
  - engagement, escalation and helpful rates; email volume; the channel filter;
  - FAQ grouping ("refund policy" wordings together; "deliver" and "delivery" together); behaviour, leads and tickets;
  - knowledge gaps, unhelpful reply with comment, escalation reasons, unanswered;
  - marking a gap handled removes it;
  - the three CSV exports, with customers anonymised; transcripts as text and JSON with feedback;
  - roles (an agent can view but not export or review); sign-in required.
  - First run: 42/43. The miss was the FAQ grouping of "refund policy please", which was fixed by the containment rule.

## 7. Demo script (about 3 minutes)

1. Chat in the widget: ask "What is your refund policy?" twice in different words, then "Do you have a store in Islamabad?" (not in the knowledge base) and give that answer a 👎 with a comment.
2. **Analytics → Overview:** response time, automation rate, leads and live sessions; the 24-hour latency chart (hover a point); recent interactions with green and amber badges.
3. **Reports:** the refund question grouped with its wordings and a high answered rate; the activity heatmap.
4. **Improve:** "Do you have a store in Islamabad?" under knowledge gaps. Click **Add answer to knowledge base**, and it disappears from the list. The 👎 appears under unhelpful replies with its comment and transcript link.
5. Export the interactions CSV and show the anonymised customers.

## 8. Limitations and future work

- **Tool-action analytics** (success rate per tool) will be added with Module 2. `AiInteraction` is the place to join them.
- Voice latency is not measured yet; there is no voice channel (Module 3).
- Aggregation runs on page load with caps of 20,000 rows per query and 1,500 FAQ questions. That suits the target scale; a larger deployment would add nightly rollups.
- Customer counts (new/returning) and ticket numbers ignore the channel filter.
- Knowledge gaps are grouped by wording only; FAQ grouping by meaning needs an embedding model.
- Latency is the model's reply time. The end-to-end first response time, including human replies, is shown separately.

## 9. File map

| Area | Files |
|---|---|
| Store and capture | `prisma/schema.prisma` (AiInteraction, MessageFeedback), `src/lib/conversation-runtime.ts`, `src/lib/ticket-workflow.ts` |
| Logic | `src/lib/analytics.ts`, `src/lib/analytics-math.ts` |
| APIs | `app/api/analytics/**`, `app/api/chat-sessions/[id]/transcript`, `app/api/widget/[widgetId]/feedback` |
| UI | `app/dashboard/analytics/**`, `src/components/dashboard/analytics-nav.tsx`, `analytics-overview-workspace.tsx`, `analytics-reports-workspace.tsx`, `analytics-improve-workspace.tsx`, `analytics-ui.tsx`, `charts/**`; widget 👍/👎 in `chatbot-widget-client.tsx` |
| Tests | `tests/unit/analytics.test.ts` |
