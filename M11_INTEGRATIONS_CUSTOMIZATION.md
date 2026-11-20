# Module 11: Integrations & System Customization

> **Status:** about 85% implemented (15 Nov 2026). The module covers five areas:
> - a security and audit log;
> - a public REST API with scoped API keys;
> - HubSpot (CRM) and Shopify (e-commerce) connectors;
> - a permission matrix;
> - admin-defined custom roles.
>
> These add to the RBAC, channels and signed webhooks built earlier (M1, M8).
>
> **Owner (Proposal work split):** Muhammad Awais · with Ahmad Mujtaba Shahid
> **Related:** [M8_LEAD_GENERATION.md](M8_LEAD_GENERATION.md) (lead webhooks) · [M2_AGENTIC_TOOLS.md](M2_AGENTIC_TOOLS.md) (AI actions) · [M9_SUPPORT_ESCALATION.md](M9_SUPPORT_ESCALATION.md) · [CHANGELOG.md](CHANGELOG.md) · [ROADMAP.md](ROADMAP.md)

---

## 1. What the module does

| ID | Feature (SRS) | What we built |
|---|---|---|
| FE-1 | Integrate with third-party systems such as CRM, help desk and e-commerce platforms | **Connectors page:**<br>• **HubSpot (CRM):** every lead becomes or updates a HubSpot contact (automatic, or "Sync now"); the HubSpot id is kept on the lead.<br>• **Shopify (e-commerce):** a new AI action, *Shopify order status*. It answers "where is my order?" with status, items and tracking, but only when the customer's email or phone matches the order.<br>Help desks and other systems use the public API and webhooks. Channels (email, WhatsApp, Slack) come from M1. |
| FE-2 | Provide APIs and connectors for extending platform functionality | **Public REST API** `/api/v1` covering tickets, contacts, leads, conversations and escalations, with an OpenAPI 3.1 description. **API Keys page** for keys with scopes, expiry and revoke. Outgoing signed webhooks (M8). |
| FE-3 | Role-based access control | RBAC on every write API (since the 60% build) plus a **permission matrix**. Routes for exports, the knowledge base, escalation rules and assignment, audit, API keys, connectors and roles check named permissions. |
| FE-4 | Allow administrators to define user roles such as admin, manager and operator | Built-in Owner / Admin / Manager / Agent, plus **custom roles** (e.g. "Senior agent", "Operator"). An admin picks a base level and adds or removes permissions, and assigns the role on the **Roles** page. |
| FE-5 | Maintain system logs and activity tracking for security and auditing | The **security & audit log** (Logs → Security & audit) records:<br>• sign-ins and failed sign-ins, sign-outs and password changes;<br>• team, role and custom-role changes;<br>• settings, integration, webhook, connector and API-key changes;<br>• deletions, data exports, API writes, and **refused access**.<br>It is append-only: a database trigger refuses edits. Filters, 7-day tiles and CSV export. |

---

## 2. Security & audit log (FE-5)

- **Entry fields:**
  - actor (team member, API key or system);
  - action (e.g. `user.role_changed`), category, outcome (done / refused / failed);
  - target, summary and details;
  - a **keyed hash of the IP address** (never the address itself) and the user agent.
- **Secrets never reach the log:** any field named like a password, token, secret, API key or cookie is replaced with `[redacted]`.
- **Refused access is logged.** `requirePermission` writes the entry itself. The older `requireRole` checks write it through a hook installed when the server starts, so `rbac.ts` stays importable in the browser. This closes the SRS event "unauthorized attempts are logged".
- **Immutability:** there is no API to change or delete entries. The `AuditLog_no_update` trigger raises an error on any `UPDATE`. Rows go only when the workspace itself is deleted.
- **Screen:** Logs → *Security & audit*. Filters by category, outcome, person, text and dates. Tiles show refused access and failed sign-ins over 7 days, with details per entry. CSV export needs both *View the audit log* and *Export data*, and the export is itself logged.

## 3. Public API and API keys (FE-2)

| Method | Path | Scope |
|---|---|---|
| GET | `/api/v1` | any valid key: workspace and scopes |
| GET / POST | `/api/v1/tickets` | `tickets:read` / `tickets:write` |
| GET | `/api/v1/tickets/{id}` | `tickets:read` (internal notes are never returned) |
| GET / POST | `/api/v1/contacts` | `contacts:read` / `contacts:write` (upsert by email or phone) |
| GET / POST | `/api/v1/leads` | `leads:read` / `leads:write` (source "Public API") |
| GET | `/api/v1/conversations`, `/api/v1/conversations/{id}` | `conversations:read` |
| GET | `/api/v1/escalations` | `escalations:read` |
| GET | `/api/v1/openapi.json` | public |

- **Key format:** keys look like `ad_live_…` (238 bits of randomness). They are **shown once**; only an HMAC is stored, with a 14-character prefix to tell keys apart.
- **Limits:** 120 requests a minute per key (429 with `Retry-After`). Usage count, last used time and network are recorded. Keys can expire (30/90/365 days) and be revoked at once.
- **Data rules:** every call is scoped to the key's workspace (another workspace's id returns 404). A ticket created by API runs the same automations as any new ticket (priority, tags, the M9 escalation check, AI reply). Every API write is audited under the key's name.
- **Errors** use `{ error: { code, message } }`: `unauthorized`, `key_expired`, `missing_scope`, `rate_limited`, `invalid_*`, `not_found`.
- **Lists** return `{ data, nextCursor }`; pass `?cursor=` for the next page and `?limit=` (1–100).

## 4. Connectors (FE-1)

| | HubSpot | Shopify |
|---|---|---|
| Connect with | Private app token (`crm.objects.contacts.read/write`) | Store address + Admin API token (`read_orders`) |
| Checked before saving | `GET /crm/v3/objects/contacts` | `GET /admin/api/2024-10/shop.json` |
| What it does | A lead becomes a HubSpot contact (search by email/phone → update, else create with lifecycle stage *lead*). Status mapped to `hs_lead_status`. Runs after every capture and update; "Sync now" sends missing or changed leads. | Adds the AI action **Shopify order status** to the workspace's agents. Shows status, payment, items and tracking, never the address. It is hidden from agents while the store is not connected. |
| Safety | Only `api.hubapi.com` is called | Only `*.myshopify.com` stores are accepted (blocks other hosts, IPs, `….myshopify.com.evil.com`); redirects refused |
| On a bad token | Connector set to *Needs attention*, alert in the bell, last error shown | Same |

Tokens are encrypted (AES-256-GCM), never returned to the browser, and deleted on disconnect. Connect, disconnect, sync and settings changes are audited.

**Order privacy:** the order is returned only if the email or phone the customer gives, or that we already know, matches it. A wrong match gets the same answer as "not found", so nobody can learn that someone else's order exists.

## 5. Roles and permissions (FE-3, FE-4)

| Permission | Agent | Manager | Admin | Owner |
|---|---|---|---|---|
| Handle tickets, chats and escalations | ✅ | ✅ | ✅ | ✅ |
| Assign and take over escalations | | ✅ | ✅ | ✅ |
| Export data (leads, analytics, escalations, audit) | | ✅ | ✅ | ✅ |
| Manage the knowledge base | | ✅ | ✅ | ✅ |
| Change escalation rules | | | ✅ | ✅ |
| View the security & audit log | | | ✅ | ✅ |
| Manage API keys | | | ✅ | ✅ |
| Manage connectors | | | ✅ | ✅ |
| Manage custom roles | | | ✅ | ✅ |

- **How a custom role works:** it has a base level (Agent / Manager / Admin) plus added and removed permissions. Giving it to a member sets their level to the base, so every older role check agrees, and attaches the additions and removals.
- **Changes to a role:** editing a role's base level updates its members. Deleting it keeps their level.
- **Safety rules:**
  - The owner always keeps every permission, so a workspace can't lock itself out.
  - Managing roles and API keys can't be given below Admin.
  - Nobody can give a role at or above their own level.
- **Screen:** **Roles** (Settings) shows the matrix with custom roles as extra columns, a create/edit form showing *From base / Added / Removed*, and a member list with a role picker.

## 6. Data model (migration `20261115120000_module11_integrations`)

- `AuditLog` (+ enums `AuditActorType`, `AuditOutcome`, and the append-only trigger).
- `ApiKey`: replaces the unused placeholder table from the 30% build.
- `Connector` (+ enums `ConnectorProvider`, `ConnectorStatus`).
- `CustomRole`, and `User.customRoleId`.
- `Lead.crmId`, `Lead.crmSyncedAt`: set in one statement with `updatedAt`, so "changed since the last sync" is exact.

## 7. Admin API reference

| Method | Path | Permission |
|---|---|---|
| GET | `/api/audit-logs` (`?category&outcome&actor&q&from&to&page`, `format=csv`) | `audit.view` (+ `data.export` for CSV) |
| GET / POST | `/api/api-keys` · DELETE `/api/api-keys/{id}` | `apikeys.manage` |
| GET / POST | `/api/connectors` · POST/DELETE `/api/connectors/{hubspot|shopify}` (`action: sync | lookup | settings`) | `connectors.manage` |
| GET / POST | `/api/roles` · PATCH/DELETE `/api/roles/{id}` | `roles.manage` |
| PATCH | `/api/users/{id}` `{ customRoleId }` | Admin |

## 8. Testing

| Level | File | IDs | What |
|---|---|---|---|
| Unit | `tests/unit/audit-and-permissions.test.ts` | UT-54 (5), UT-59 (4), UT-60 (4), UT-57 (4) | Permission matrix, custom-role validation, owner lock-out guard; secret redaction, changed fields, audit filters; key generation and hashing, key form, cursor pages, OpenAPI coverage; Shopify domain check, order ownership, order summary, HubSpot mapping |
| Integration | `tests/integration/audit-log.int.ts` | IT-22 (7) | Sign-in and wrong password logged with hashed IP; role change and removal; refused role and permission logged; filters and workspace isolation; CSV needs export; **UPDATE refused by the database** |
| Integration | `tests/integration/public-api.int.ts` | IT-23 (11) | Key shown once and hashed; 401 without or with a bad key; usage counted; missing scope 403 + audited; ticket created with contact and audit; internal notes hidden; filters and cursor pages; contacts and leads; conversations and escalations; other workspace 404; expiry and revoke; rate limit 429; public OpenAPI |
| Integration | `tests/integration/connectors.int.ts` | IT-24 (10) | Admin-only; wrong token refused and nothing saved; token encrypted and never returned; automatic lead → HubSpot; status update; Sync now skips unchanged leads; revoked token → needs attention + alert; only `*.myshopify.com`; action appears when connected; order shown only to its customer; disconnect deletes the token |
| Integration | `tests/integration/custom-roles.int.ts` | IT-25 (6) | Admin-only and validated; assignment sets level and is audited; added permission (export) works; removed permission (knowledge) refused and logged; base-level change and delete; no role above your own level |
| Browser | `tests/ui/integrations-admin.spec.ts` | UI-M11-01…05 | Audit tab and filter, API key once → works → revoked, custom role in the matrix, Shopify address check, OpenAPI. **5/5 passed on 16 Nov.** |

HubSpot and Shopify are replaced in IT-24 by an in-memory fake behind `fetch`; the routes, database, encryption, sync and AI action are real. Results on 15 Nov: unit 290/290; integration all files green (34 new); typecheck 0 errors; lint 0 errors.

## 9. Demo script (about 4 minutes)

1. **Roles:** show the matrix, then create "Senior agent" (Agent + Export data + Assign escalations) and give it to an agent.
2. **API Keys:** create "Store back-end" with tickets read/write; copy the key once.
3. Run `curl …/api/v1/tickets -H "Authorization: Bearer ad_live_…" -d '{"subject":"Order 1042 damaged","message":"Lid cracked","requester_email":"ali@example.com"}'`. Show the ticket on the Tickets page with its automations.
4. **Logs → Security & audit:** the key's write, the role change, your sign-in. Filter *Refused* after an agent tries Settings.
5. **Connectors:** connect a HubSpot developer account, capture a lead in the widget, then show it in HubSpot. Connect a Shopify development store and ask the widget "where is order 1001?" with the order's email.
6. Revoke the key and run the curl again: 401.

## 10. Limitations and future work

- **Connectors:** HubSpot and Shopify only (no Salesforce, Zendesk or WooCommerce yet); other systems use the API and webhooks. The connectors were tested against a fake of each vendor API, not a live HubSpot portal or Shopify store.
- **HubSpot sync** is one-way (AssistDesk → HubSpot) and runs in the server process. A failed automatic sync is retried by "Sync now", not on a schedule.
- **Public API gaps:** no endpoints for updating or closing tickets, knowledge-base content, or webhook management (the dashboard does these).
- **Permission scope:** custom roles change only the eleven listed permissions (nine from M11, `billing.manage` from M3 and `refunds.approve` from M2); other pages follow the base level.
- **Audit retention:** the log is kept forever; there is no retention setting.
- **PGlite test database:** it mixes up parallel queries after a constraint error (OPS-10). The roles API checks names first and reads sequentially for that reason; real PostgreSQL is unaffected.

## 11. File map

| Area | Files |
|---|---|
| Audit | `src/lib/audit.ts`, `src/lib/audit-queries.ts`, `src/lib/access.ts`, `app/api/audit-logs/route.ts`, `src/components/dashboard/audit-log-workspace.tsx`, `logs-tabs.tsx`, hooks in auth, users, settings, integrations, webhooks, deletes and exports |
| Permissions & roles | `src/lib/permissions.ts`, `src/lib/custom-roles.ts`, `src/lib/rbac.ts` (denial hook), `src/lib/auth.ts` (session loads the custom role), `app/api/roles/**`, `app/api/users/[id]/route.ts`, `app/dashboard/roles/page.tsx`, `src/components/dashboard/roles-workspace.tsx` |
| API | `src/lib/api-keys.ts`, `src/lib/api-keys-public.ts`, `src/lib/public-api.ts`, `src/lib/public-api-spec.ts`, `src/lib/ticket-create.ts`, `app/api/v1/**`, `app/api/api-keys/**`, `app/dashboard/api-keys/page.tsx`, `src/components/dashboard/api-keys-workspace.tsx` |
| Connectors | `src/lib/connectors.ts`, `app/api/connectors/**`, `app/dashboard/connectors/page.tsx`, `src/components/dashboard/connectors-workspace.tsx`, `src/lib/tools/builtin-tools.ts` (`shopify_order_status`), `src/lib/tools/registry.ts`, `src/lib/leads.ts` (sync hook) |
| Data | `prisma/schema.prisma`, `prisma/migrations/20261115120000_module11_integrations/` |
| Tests | `tests/unit/audit-and-permissions.test.ts`, `tests/integration/{audit-log,public-api,connectors,custom-roles}.int.ts`, `tests/ui/integrations-admin.spec.ts` |
