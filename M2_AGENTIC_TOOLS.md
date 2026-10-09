# Module 2: Agentic Tool & Action Management

**Status:** ≈ 90% (2026-10-09) · **Owner:** Muhammad Awais (FE-1, FE-2), Ahmad Mujtaba Shahid (FE-3, FE-4 per the Proposal work split)
**SRS:** Module 2 FE-1 – FE-5, CON-4 (LangGraph), SEC-2 (RBAC on tool execution), UI-4 (paginated, filterable, sortable logs)
**Companion files:** [CHANGELOG.md](CHANGELOG.md) · [ROADMAP.md](ROADMAP.md) · VULNERABILITIES.md (local only)

---

## 1. What the module does

The proposal calls AssistDesk an *execution layer, not a conversation layer*. Module 2 is that layer: an AI agent can **do things** for a customer, not just answer.

| SRS feature | What was built |
|---|---|
| **FE-1** Predefined actions | 8 built-in actions: customer info, ticket status, create ticket, capture lead, hand over to a human, check availability, **book appointment**, search knowledge base. **Order tracking** and **invoice generation** come as ready-made HTTP tool templates (a demo store is included). |
| **FE-2** Multi-step reasoning | A **LangGraph** `StateGraph` (`agent ⇄ tools`) plans several steps for one message, for example *check free slots → book → confirm*. It has a step limit, a time budget and a fallback chain across models. |
| **FE-2b** Custom actions | Admins connect **their own systems** with HTTP tools: a URL template, a method, the inputs the AI collects, encrypted secret headers, a JSON body template, and the response fields the AI may see. |
| **FE-3** Admin configuration | A **Tools** page (enable, describe, build, test), an **Actions** tab per agent (which tools it may use, reasoning steps, hand-over on failure), and an **Appointments** page. |
| **FE-4** Intent → action mapping | Per-agent **intent rules**: “where is my order, track my order → Track order”, either *Suggest* (guides the model) or *Always run first* (forces the first tool call). |
| **FE-5** Action logs / chain of thought | Every reasoning run is stored with its **chain of thought**: rules matched, thoughts, every action with the model's stated reason, inputs, results, model failures, fallbacks and hand-overs. It is shown in **Logs → AI actions**, in the **Playground**, in the **Chats** side panel, and summarised in **Analytics → Reports**. |
| SRS events | “A tool call is executed and logged” ✔. “On failure, inform the user and optionally escalate” ✔ (`escalateOnToolFailure`). |
| SEC-2 | RBAC on every tool API (see §6). Actions that change data **need the customer's confirmation**, enforced on the server. |

---

## 2. How a message is handled

```
customer message (widget / WhatsApp / Slack / email / Playground)
   │
   ├─ 1. Agent has actions? (toolsEnabled + bound + enabled tools)
   │       no  → normal knowledge-base answer (Module 1/10, unchanged)
   │       yes ↓
   ├─ 2. AgentRun created (status RUNNING)
   ├─ 3. Pending confirmation?  "yes" → the held action runs now (server-side)
   │                            "no"  → cancelled;   anything else → still waiting
   ├─ 4. System prompt = grounded prompt (knowledge, memory, safety rules)
   │                    + tool rules + today's date in the workspace time zone
   │                    + intent rules (matched ones highlighted) + confirmation note
   ├─ 5. LangGraph loop (max N steps, 25 s budget, 15 s per model call)
   │       agent node: model chain (agent's own provider → managed Groq → Google → OpenRouter)
   │       tools node: validate → (hold for confirmation) → execute → log ToolExecution
   │       last step: tools removed, the model must answer
   ├─ 6. No answer? fallbacks in order:
   │       confirmed-action reply → answer composed from tool results → plain KB answer
   ├─ 7. Unrecovered tool failure + escalateOnToolFailure → escalate_to_human (RULE)
   └─ 8. AgentRun updated: answer, status, steps, toolCalls, model, latency, trace
```

Code: `src/lib/agent-engine/run-agent.ts` (steps 2–8), `graph.ts` (step 5), `model-chain.ts`, `intent-rules.ts`, `tool-summary.ts`, `run-trace.ts`; tools in `src/lib/tools/*`.

The same engine runs on **every channel**: `conversation-runtime.ts` (widget, WhatsApp, Slack) and `ticket-workflow.ts` (email tickets) use it when the agent has actions; the Playground uses it in **test mode**.

### 2.1 Run statuses

| Status | Meaning |
|---|---|
| `COMPLETED` | The reasoning chain answered. |
| `AWAITING_CONFIRMATION` | An action is held; the AI asked the customer “Shall I go ahead?”. |
| `MAX_STEPS` | The step limit was reached; the model answered without more tools. |
| `FALLBACK` | No model could finish; the answer was composed from tool results or by the knowledge-base path. |
| `FAILED` | No model was reachable; the extractive knowledge-base fallback replied. |

### 2.2 Confirmation (actions that change something)

Tools marked **“Ask the customer first”** (`requiresConfirmation`) never run on the model's word alone:

1. The model calls the tool. The registry validates the input and stores the call as `PENDING_CONFIRMATION` (one per conversation; a newer one replaces the older).
2. The tool result tells the model to ask: *“Book an appointment on Wed 7 Oct, 11:30 for Sara Ahmed. Shall I go ahead?”*
3. The customer's **next message** is checked on the server **before** the model sees it (`detectConfirmation`, English and Roman Urdu: *yes, ok, haan, ji, bilkul, kar do* / *no, cancel, nahi, ruko*; negations win). Yes → it runs (`triggeredBy: CONFIRMATION`); no → `CANCELLED`; anything else → still waiting.
4. Held actions expire after **30 minutes** (on the next message, and by the sessions cron).
5. **No chat, no action:** on email there is nobody to confirm with, so the call is `DENIED` and the AI offers to arrange it with the team.

Two refinements found with real models:

- **The model asked first.** Free models often ask “Would you like me to book it?” *before* calling the tool. If the customer's reply is a clear **yes to the assistant's question**, the one confirmation-needing action the model then calls runs immediately (logged as *confirmed by the customer's reply: “…”*), so the customer is never asked twice. This applies once per message, never when another action is already held, and never in test mode.
- **No re-proposal.** In the turn where a held action was just confirmed and ran, that tool is removed from the model's toolset, so it cannot propose the same booking again.

### 2.3 Test mode (Playground)

The Playground runs the same engine with `dryRun`: **lookups run for real** (ticket status, availability, GET tools), **anything that changes data is simulated** (no ticket, lead, booking or HTTP write happens) and confirmation is skipped. Only simulated actions are marked *Test mode*. Playground runs never count in statistics.

---

## 3. The tools

### 3.1 Built-in actions (`src/lib/tools/builtin-tools.ts`)

| Key | Kind | Confirm | What it does |
|---|---|---|---|
| `get_customer_info` | Lookup | – | The customer's record (masked email/phone, counts). Unverified visitors get counts only (M5 trust level). |
| `lookup_ticket_status` | Lookup | – | Status of the customer's **own** ticket (`AD-1042`, `#1042`, `1042`). Other people's tickets get the same “not found” answer, so numbers can't be enumerated. |
| `create_ticket` | Changes data | – | Opens a ticket linked to the customer and conversation (P2002 retry, inbox prefix, source from the channel). |
| `capture_lead` | Changes data | – | Saves a sales lead through Module 8 (`source: AI_TOOL`). |
| `escalate_to_human` | Changes data | – | Hands the chat to the team (session `ESCALATED`, takeover event, notification; on tickets an internal note). |
| `check_availability` | Lookup | – | Free appointment slots (workspace hours, slot length, 60-min lead time, optional date). |
| `book_appointment` | Changes data | **Yes** | Books a slot after re-checking it inside a **serializable transaction**; links the chat and contact; notifies the team. |
| `search_knowledge_base` | Lookup | – | Searches the agent's knowledge base (Module 10 hybrid retrieval). |

Admins can switch each one off, reword its description (with “restore default”) and, for actions that change data, decide whether the customer must confirm.

**Privacy:** the AI only sees masked contact details. If the model echoes a masked value back (`s***@example.com`), it is ignored and the customer's real details from the session are used.

### 3.2 Custom HTTP tools (`http-tool.ts`, `tool-admin.ts`)

| Setting | Notes |
|---|---|
| Name → key | “Track order” → `track_order` (unique per workspace; built-in names are reserved). |
| Description | What it does **and when to use it**: the model decides from this text. |
| Method + URL | `GET/POST/PUT/PATCH/DELETE`; inputs go in the path or query as `{order_number}` (URL-encoded). Unused inputs go to the query (GET/DELETE) or the JSON body. |
| Inputs | Up to 10: text / number / whole number / yes-no, required or optional, allowed values. `reason` is reserved. |
| Headers | Secret headers (`Authorization`, API keys…) are **encrypted at rest** (AES-256-GCM), shown masked (`••••9876`), and kept when an edit leaves them blank. |
| Body template | JSON; `"{name}"` alone keeps the input's type. |
| Response fields | Dot paths kept for the model (`status, items, customer.name`); everything else is dropped. The result is trimmed to 4,000 characters. |
| Timeout | 3–15 s. |
| Ask first | On by default for anything that isn't `GET`. |

**Safety (SSRF and abuse):** https only in production; **no placeholders in the host** (inputs can never choose the server); the host must resolve to a **public address** (private, loopback and link-local are blocked unless `ASSISTDESK_ALLOW_PRIVATE_TOOLS=true` in development); redirects refused; 100 KB response cap; secret header values never reach logs or the model.

**Templates:** *Order tracking* (GET) and *Invoice generation* (POST, asks first) point at the built-in **sample store** (`/api/sample-store/*`, Bearer `demo-store-key`, deterministic fake orders, dates in Pakistan time). *CRM lookup* is a skeleton for your own API. The sample store is on in development and off in production unless `ASSISTDESK_SAMPLE_STORE=true`.

### 3.3 Intent rules (`intent-rules.ts`)

Up to 20 rules per agent; each has up to 10 phrases (normalised, whole-word match) and an action the agent may use. All rules are explained to the model; the ones matching the message are highlighted. The first matching **Always** rule forces that tool on the first step (`tool_choice`), with an automatic retry without forcing for models that don't support it. A confirmed action never re-forces a tool.

### 3.4 Model chain and resilience (`model-chain.ts`, `model-health.ts`)

- `ChatOpenAI` with a `baseURL` per provider covers OpenAI, Groq, Google (OpenAI-compatible endpoint), Anthropic and OpenRouter.
- The agent's own provider is tried first, then the managed chain. `maxRetries: 0`, 15 s per call, 25 s per run.
- **Retired models are remembered:** a 404 / “not available” answer marks that model as retired for 6 hours, so the chain stops wasting a call on it (rate limits and timeouts don't count). A chain is never emptied.
- Error messages are cleaned (LangChain troubleshooting URLs removed) before they reach the logs.

---

## 4. Chain of thought and visibility (FE-5)

`AgentRun.trace` stores the decisions of a run in order:

| Entry | Example |
|---|---|
| `confirmation` | Customer said yes — ran the waiting action *Book appointment* |
| `intent` | “where is my order” → `track_order` (always run first) |
| `thought` | The model's text between tool calls |
| `tool` | Step 1 · *Track order* · Done · *Why: Customer asked where order 1042 is* (by execution id) |
| `model_error` | `openrouter/google/gemma-4-31b-it:free` failed (429). Tried the next model. |
| `fallback` | No model could write the answer; it was composed from the action results. |
| `escalation` | Handed over to the team because `track_order` failed. |

Inputs and results stay on `ToolExecution` (not duplicated in the trace). A run's detail also shows an action proposed in an earlier run and confirmed in this one.

**Where it appears:**

| Place | What you see |
|---|---|
| **Logs → AI actions** | Headline numbers (last 30 days, no Playground), *Conversation turns* or *Individual actions*; filters: status, channel, trigger, agent, action, date range, search; sort: newest, oldest, slowest, most actions; pagination; click a row for the full timeline with links to the chat, ticket and customer. Deep links: `?tab=actions&run=…`, `&session=…`, `&tool=…`. |
| **Playground** | “Show reasoning (N actions)” under each reply; “Testing as” a chosen customer name/email. |
| **Chats side panel** | “AI actions”: each action with result, reason, time, *after customer's yes*, a banner when an action waits for the customer, and a *Why?* link to its chain of thought. |
| **Analytics → Reports** | Messages handled, completed and fallback rates, average run time and steps; per action: calls, done, failed, not run, success rate, avg / p95 time; how runs ended. |
| **Tools page** | Per tool: calls, success and average time over 30 days, which agents use it, last test result. |

---

## 5. Admin screens

- **Tools** (`/dashboard/tools`, Manager+): built-in actions and *Your systems*; switch, edit, **Test** (built-in writes are simulated; HTTP tools really call the API), stats; **New tool** from blank or a template; live checks in the builder (unknown placeholders, duplicate inputs, reserved names, JSON body, host placeholders).
- **Agent → Actions tab:** master switch, allowed actions (with *Lookup / Changes data / Asks customer first / switched off / last test failed* badges), reasoning steps 1–8, hand over on failure, intent rules with a **“Try a customer message”** preview, sticky save bar with unsaved-changes state.
- **Appointments** (`/dashboard/appointments`, all roles): Upcoming / Past / Cancelled / All, search, grouped by day (*Today*, *Tomorrow*), complete / undo / cancel (with a race-safe status check) / notes, a link to the chat it was booked in; **Book appointment** (a day's free times, same rules as the AI); **Booking hours** (Admin) and the next free times the AI would offer.

---

## 6. Roles (SRS SEC-2)

| Action | Agent | Manager | Admin/Owner |
|---|---|---|---|
| See Action logs, Appointments; book, cancel, complete | ✔ | ✔ | ✔ |
| See Tools; switch tools on/off; reword built-ins; test built-ins | – | ✔ | ✔ |
| Agent Actions tab (bindings, steps, intent rules) | – | ✔ | ✔ |
| Create / edit / test / delete **HTTP tools** (they call outside systems with stored credentials) | – | – | ✔ |
| Change a built-in's confirmation rule; booking hours | – | – | ✔ |

Every query is scoped to the signed-in workspace; other workspaces' tools and runs return 404.

---

## 7. Data model

Migrations `20261003090000_module2_tools` and `20261006090000_module2_run_trace`.

| Model / field | Purpose |
|---|---|
| `AgentTool` | key, name, description, `type` (BUILT_IN / HTTP), built-in key, parameters (JSON), HTTP method/URL/headers (encrypted secrets)/body/timeout/response fields, `requiresConfirmation`, `isEnabled`, last test. Unique `(workspaceId, key)`. |
| `AgentToolBinding` | Which agent may use which tool. |
| `AgentRun` | One reasoning chain for one message: question, answer, status, steps, tool calls, model, latency, error, source (CHAT / EMAIL / PLAYGROUND), **trace**. |
| `ToolExecution` | One action: step, tool key/name, **reasoning**, input, output, status (SUCCESS / ERROR / DENIED / PENDING_CONFIRMATION / CANCELLED), error, latency, `triggeredBy` (MODEL / RULE / CONFIRMATION / TEST), `dryRun`, resolved at. |
| `Appointment` | name, email, phone, topic, starts at, duration, status (BOOKED / CANCELLED / COMPLETED), notes, created by (AI / TEAM), contact and session links. |
| `AIAgent` + | `toolsEnabled`, `maxToolSteps` (4), `escalateOnToolFailure` (true), `intentRules`. |
| `WorkspaceSetting` + | `appointmentSlotMinutes` (30), `appointmentHours` (Mon–Fri 09:00–17:00), `appointmentDaysAhead` (14). |

Deleting a chat or ticket deletes its runs and actions; deleting a tool keeps its past actions (by key and name).

---

## 8. API reference

| Method & path | Role | Purpose |
|---|---|---|
| `GET /api/tools` | Manager | Tools (seeds built-ins), stats, agents, templates. |
| `POST /api/tools` | Admin | Create an HTTP tool (optionally bound to agents). |
| `PATCH /api/tools/[id]` | Manager / Admin | Toggle, reword a built-in; Admin: edit HTTP tool, confirmation rule. |
| `DELETE /api/tools/[id]` | Admin | Delete an HTTP tool (built-ins can only be switched off). |
| `POST /api/tools/[id]/test` | Manager (built-in) / Admin (HTTP) | Run once with sample inputs; logged as TEST. |
| `GET` / `PUT /api/ai-agents/[id]/tools` | Manager | Agent actions: switch, bindings, steps, hand-over, intent rules (validated). |
| `GET /api/appointments` | any | List with view, search, pagination, settings, next free slots. |
| `POST /api/appointments` | any | Team booking. |
| `PATCH /api/appointments/[id]` | any | Status (BOOKED ⇄ COMPLETED, BOOKED → CANCELLED) and notes. |
| `GET /api/appointments/slots?date=` | any | A day's free times. |
| `PUT /api/appointments/settings` | Admin | Booking hours, slot length, days ahead. |
| `GET /api/action-logs` | any | Runs or actions with filters, sort, pagination, summary. |
| `GET /api/action-logs/runs/[id]` | any | One run's chain of thought with its actions. |
| `POST /api/ai-agents/[id]/playground` | signed in | Now also returns `run` (the chain of thought). |
| `GET /api/sample-store/orders/[number]`, `POST /api/sample-store/invoices` | demo key | Sample store for the templates. |

The sessions cron (`/api/cron/sessions`) also expires unanswered confirmations.

---

## 9. Testing

| Suite | Cases | Covers |
|---|---|---|
| `tests/unit/tools.test.ts` | 26 | Tool keys and parameters, JSON schema, input validation and coercion, URL/body templates, response fields, secret headers, **host-placeholder SSRF rule**, confirmation words (English/Roman Urdu), appointment hours and slots incl. DST, intent rules, tool-result answers, chain-of-thought trace, action usage report, retired-model memory. |
| `tests/integration/tools.int.ts` | 14 | Registry and every built-in on a real database; ticket privacy; confirmation hold / yes / no / expiry; **masked details never stored**; HTTP tool with a mock API (decrypted header, field filter, dry run, errors, timeouts). |
| `tests/integration/agent-engine.int.ts` | 11 | LangGraph engine with scripted models: multi-step booking with confirmation, **confirmed tool not re-offered**, **consent to the assistant's own question** (and when it must still ask), deterministic reply, model fallback, tool-result fallback, KB fallback, step limit, unknown tool, ALWAYS rule, failure → auto hand-over; stored traces. |
| `tests/integration/tool-admin.int.ts` | 11 | Admin APIs through the real route handlers: RBAC per role, validation, secret masking and keeping, testing, built-in edits, workspace isolation, agent bindings and rules, booking hours, team booking, status changes. |
| `tests/integration/action-logs.int.ts` | 6 | Action logs API: auth, summary, filters, sorting, pagination, actions view, cross-run confirmation detail, isolation. |
| `tests/integration/real-model.int.ts` | 1 (opt-in) | A real free model calls `lookup_ticket_status` and answers from it (`RUN_REAL_LLM=1`). |

Run: `npm test` (unit) and `TEST_DATABASE_URL=postgresql://… npm run test:integration` (needs a throwaway database with migrations applied; never production).

**End-to-end with a real model** (scratch script against the dev server, widget API, OpenRouter free tier): order tracking forced by the intent rule → real `track_order` call → factual reply; booking → held until “yes” → booked once with the real email → Action logs list it. **16/16 checks passed** (run 3, 2026-10-06). Runs 1–2 found the bugs listed in the CHANGELOG (masked email stored, double confirmation, re-proposal, promised email).

---

## 10. Demo script (about 5 minutes)

1. **Tools page:** show the 8 built-in actions. *New tool → Order tracking*, create, **Test** with order `1042` → result in under a second.
2. **AI Agents → Support Assistant → Actions:** switch on, select all, add the rule *“where is my order” → Track order, Always run first*; type a message in *Try a customer message* to show the match. Save.
3. **Website widget:** *“Hi, where is my order 1042?”* → real status and delivery date.
4. *“Can you book me an appointment tomorrow at 11:30?”* → the AI asks to confirm → *“Yes please”* → booked.
5. **Chats → this chat → AI actions** panel: three actions, *after customer's yes*, **Why?** → the full chain of thought (rule matched, model fallback, reasons, inputs, results).
6. **Appointments:** the booking, *Booked by AI*, link back to the chat.
7. **Analytics → Reports → AI actions:** per-action success rate and timing.

Tip: set a free **Groq** key (`ASSISTDESK_DEFAULT_GROQ_API_KEY`) before the demo; the free OpenRouter models are slower (7–12 s) and sometimes rate-limited.

---

## 11. Limitations and future work

- Free models' tool calling varies: they may skip a tool or ask permission themselves. Intent rules (*Always*), server-side confirmation and the tool-result fallback keep answers factual; a Groq or paid model is recommended.
- Confirmation words are rule-based (English, Roman Urdu); an unusual reply (“sure thing, but…”) may be read as yes or ignored.
- The SSRF check resolves DNS before the request (same DNS-rebinding window as webhooks); an admin can send customer data to any public API they configure.
- Results from external APIs reach the model (trimmed and field-filtered); a hostile API could try prompt injection.
- No OAuth connectors (Shopify, HubSpot…) yet; tools use static headers.
- No appointment reminders or calendar sync; cancelling doesn't notify the customer automatically.
- The retired-model memory is per server process.

---

## 12. File map

| Area | Files |
|---|---|
| Engine | `src/lib/agent-engine/{run-agent, graph, model-chain, intent-rules, tool-summary, run-trace}.ts`, `src/lib/model-health.ts` |
| Tools | `src/lib/tools/{tool-schema, builtin-tools, registry, http-tool, appointments, appointments-math, tool-admin}.ts`, `src/lib/sample-store.ts` |
| Logs & analytics | `src/lib/action-logs.ts`, `src/lib/analytics.ts` (`actions`), `src/lib/analytics-math.ts` (`summarizeToolUsage`) |
| Runtime wiring | `src/lib/conversation-runtime.ts`, `src/lib/ticket-workflow.ts`, `src/lib/llm-runtime.ts`, `app/api/ai-agents/[id]/playground/route.ts`, `app/api/cron/sessions/route.ts` |
| APIs | `app/api/tools/**`, `app/api/ai-agents/[id]/tools`, `app/api/appointments/**`, `app/api/action-logs/**`, `app/api/sample-store/**` |
| UI | `src/components/dashboard/tools/{tools-workspace, agent-tools-panel, appointments-workspace, action-logs-workspace, run-timeline, chat-actions-section, tool-ui}.tsx`, `logs-tabs.tsx`, edits in `agent-configuration-workspace.tsx`, `chats-workspace.tsx`, `analytics-reports-workspace.tsx`, sidebar/config |
| Pages | `app/dashboard/tools`, `app/dashboard/appointments`, `app/dashboard/logs?tab=actions`, agent `?tab=actions` |
| Schema | `prisma/schema.prisma`, migrations `20261003090000_module2_tools`, `20261006090000_module2_run_trace` |
| Tests | `tests/unit/tools.test.ts`, `tests/integration/*.int.ts`, `vitest.integration.config.mts` |
