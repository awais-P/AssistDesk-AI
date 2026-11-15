# Module 3: Subscription & Payment Management

> **Status:** about 85% implemented (16 Nov 2026).
> - Four plans with real limits.
> - Payments through **Stripe** (Checkout, subscriptions, customer portal, signed webhooks).
> - Automatic renewal and failed-payment handling.
> - Upgrade, downgrade with proration, and cancel.
> - Invoices and billing history.
> - A 14-day trial for new workspaces.
>
> **Owner:** Muhammad Awais · with Ahmad Mujtaba Shahid
> **Related:** [M11_INTEGRATIONS_CUSTOMIZATION.md](M11_INTEGRATIONS_CUSTOMIZATION.md) (permissions, audit log) · [CHANGELOG.md](CHANGELOG.md) · [ROADMAP.md](ROADMAP.md)

---

## 1. What the module does

| ID | Feature (SRS) | What we built |
|---|---|---|
| FE-1 | Tiered subscription plans | **Free, Starter ($19/month), Growth ($49), Business ($149)**, monthly or yearly (two months free). Each plan has limits on AI replies per month, AI agents, chatbots, team members and knowledge sources. The limits are **enforced**: creating one more returns a clear "upgrade" message (HTTP 402), and the AI hands over to the team when the month's replies are used up. |
| FE-2 | Process payments securely through integrated gateways | **Stripe Checkout** takes the card on Stripe's page, so AssistDesk never sees card details. Webhooks are verified with the Stripe signature over the raw body and handled once per event id. Secrets come only from the environment. |
| FE-3 | Recurring billing with automatic renewal | Stripe renews each subscription and retries failed payments. `customer.subscription.updated` moves the billing period on, a failed payment marks it *past due* (the plan stays during retries), and `deleted` moves the workspace to Free. Trials end automatically (hourly job and cron). |
| FE-4 | Upgrade, downgrade or cancel | **Upgrade or downgrade** in one click: the Stripe price is switched with proration, so the difference is charged or credited. A downgrade is refused while more is in use than the smaller plan allows. **Cancel** keeps the plan to the end of the paid period and can be undone. The Stripe customer portal handles changing the card. |
| FE-5 | Invoices and payment history | Every Stripe invoice (paid, open, failed) is stored with Stripe's hosted page and PDF. Each invoice also has a **printable AssistDesk invoice page**. **Billing history** lists trial ends, activations, renewals and changes, and every billing action is in the M11 audit log. |

---

## 2. How it works

### 2.1 Plans and limits

| | Free | Starter | Growth | Business |
|---|---|---|---|---|
| Price (month / year) | $0 | $19 / $190 | $49 / $490 | $149 / $1,490 |
| AI replies a month | 100 | 1,000 | 5,000 | 25,000 |
| AI agents | 1 | 2 | 5 | unlimited |
| Chatbots | 1 | 2 | 5 | unlimited |
| Team members | 2 | 3 | 10 | 50 |
| Knowledge sources | 5 | 25 | 100 | unlimited |

The plans are defined in `src/lib/billing-plans.ts` (one place for the page, the checks and Stripe prices). **Where limits are checked:**
- creating an AI agent, a chatbot or a knowledge source;
- inviting team members (the whole invite is checked);
- before every AI reply on the website, WhatsApp, Slack and email tickets. When the replies are used up, the customer gets one notice that a person will reply, and the team is alerted at most once a day.

### 2.2 Which plan applies

| Subscription | Effective plan |
|---|---|
| None (workspace created before billing existed) | **No limits** until a plan is chosen, so existing demo data keeps working |
| Trial, not ended | The trial plan (Growth), with the days left shown |
| Trial ended | Free (the hourly job also records it and alerts the team) |
| Active | The paid plan |
| Past due (Stripe is retrying) | Still the paid plan |
| Cancelled, or checkout not finished | Free |

### 2.3 The Stripe flow

```
 Choose plan ──► POST /api/billing/checkout ──► Stripe Checkout (card on Stripe's page)
                                                     │
            Stripe ──► POST /api/billing/webhook (signed) ──► checkout.session.completed
                                                     │            → subscription ACTIVE
          every month/year: invoice.paid / payment_failed / customer.subscription.updated
                                                     │            → period, invoices, alerts
 Upgrade/downgrade ──► prices.create + subscriptions.update (create_prorations)
 Cancel            ──► subscriptions.update(cancel_at_period_end) ──► …deleted → Free
 Card & receipts   ──► Stripe customer portal
```

- **No dashboard setup:** Checkout uses `price_data`, so no products need creating in the Stripe dashboard. Only the secret key and the webhook secret are needed.
- **Recent Stripe API versions** keep the billing period on the subscription *item*; the sync reads either place.
- **Idempotency:** each event id is stored in `BillingEvent`, so a repeated event is ignored. An error answers 500 so Stripe retries.

### 2.4 Test mode (development only)

Without `STRIPE_SECRET_KEY`, and only when `NODE_ENV` is not `production`, the server uses a **TEST provider**:
- choosing a plan activates it at once and writes a paid test invoice;
- changes charge a prorated difference;
- renewals and cancellations run in the hourly job.

The Billing page shows a yellow "Test mode: no money is taken" banner, and invoices say so. In production without a key, payments are simply off. Set `ASSISTDESK_BILLING_TEST_MODE=false` to switch test mode off in development.

### 2.5 Who can do what

The **Manage the subscription** permission (`billing.manage`, Admin and Owner; it can't be given below Admin) covers choosing, changing and cancelling the plan, the portal, and viewing invoices. Everyone can see the plan and usage.

---

## 3. Setup with Stripe (test keys)

1. Stripe dashboard → Developers → API keys: copy the **test** secret key into `.env` as `STRIPE_SECRET_KEY`.
2. Run `stripe listen --forward-to localhost:3000/api/billing/webhook` (Stripe CLI) and copy the `whsec_…` value into `STRIPE_WEBHOOK_SECRET`. In production, add a webhook endpoint for `/api/billing/webhook` with the events `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed` and `invoice.finalized`.
3. Optionally set `NEXT_PUBLIC_APP_URL` so the Checkout return links use your public address.
4. In Billing, choose a plan and pay with one of **Stripe's published test cards** (for example 4242 4242 4242 4242, any future date and CVC). Use a declining test card to see a failed payment.

## 4. Data model (migration `20261116090000_module3_billing`)

- **`Subscription`** (one per workspace):
  - plan and interval;
  - status (`TRIALING` / `ACTIVE` / `PAST_DUE` / `CANCELED` / `INCOMPLETE`);
  - provider (`STRIPE` / `TEST`), Stripe customer and subscription ids;
  - current period, trial end, `cancelAtPeriodEnd`.
- **`Invoice`**: number, status, currency, amounts in cents, plan and interval, period, hosted and PDF links, paid time.
- **`BillingEvent`**: provider event id (unique, for idempotency), type, workspace and a summary for the history.

## 5. API reference

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/billing` | any member | Plan, effective plan, usage, limits, invoices, history, mode |
| POST | `/api/billing/checkout` `{ plan, interval }` | `billing.manage` | Stripe Checkout URL (or activate in test mode) |
| POST | `/api/billing/change` `{ plan, interval }` | `billing.manage` | Upgrade or downgrade (402/409 explain why not) |
| POST | `/api/billing/cancel` `{ cancel }` | `billing.manage` | Cancel at the period end, or undo |
| POST | `/api/billing/portal` | `billing.manage` | Stripe customer portal URL |
| GET | `/api/billing/invoices/{id}` | `billing.manage` | Printable invoice |
| POST | `/api/billing/webhook` | Stripe (signed) | Subscription and invoice events |

Limit errors from other routes: `402 { error, code: "plan_limit" }`.

## 6. Testing

| Level | File | IDs | What |
|---|---|---|---|
| Unit | `tests/unit/billing.test.ts` | UT-58 (8) | Tiers and prices, yearly saving, effective plan (none, trial, trial ended, past due, cancelled), upgrade/downgrade detection, downgrade blockers, limit messages |
| Integration | `tests/integration/billing.int.ts` | IT-26 (10) | Pre-billing workspace unlimited; 14-day trial with real seat limit on the invite route (402); trial end → Free + alert; checkout permission and activation with invoice; prorated upgrade; downgrade refused while over the limit; cancel / undo / end → Free; automatic renewal with a new invoice; AI-reply limit alert once; billing API; printable invoice for the right people only |
| Integration | `tests/integration/billing-stripe.int.ts` | IT-27 (8) | Checkout session with price, metadata and customer; unsigned or wrongly signed webhooks refused; completed checkout activates once (duplicate ignored); paid and failed invoices stored, alert on failure; past due keeps the plan, renewal moves the period; upgrade = new price + proration; cancel and deletion → Free; customer portal |
| Browser | `tests/ui/billing.spec.ts` | UI-BIL-01…03 | Billing page with plan, meters and four plans; yearly prices and saving; forged webhook refused |

- **Stripe in IT-27:** Stripe is replaced by a fake client for its API calls. The webhooks are real Stripe-signed payloads, generated by Stripe's own test helper and verified by the real code.
- **Browser purchase flow:** the browser test does not buy a plan, because that would put limits on the shared demo workspace; IT-26 and IT-27 cover the purchase flow.
- **Results on 16 Nov:**
  - unit 325/325;
  - integration all green, 155 tests incl. 18 new;
  - browser UI-BIL 3/3 and UI-M11 5/5, plus the tickets, leads, analytics and escalations suites (22/22);
  - typecheck 0 errors.

## 7. Demo script (about 3 minutes)

1. **Settings → Billing:** the current plan, the trial days left, and the usage meters.
2. Switch Monthly/Yearly to show the yearly prices and saving.
3. **Choose Growth:** this opens Stripe Checkout; pay with Stripe's test card 4242 4242 4242 4242. Back on the page the plan is active, and the invoice and history appear.
4. **Upgrade** to Business; show the prorated invoice in Stripe. **Downgrade** to Starter while you have 9 team members: the refusal explains why.
5. **Cancel:** the plan stays until the period end. Then **Keep my plan**.
6. On a Free workspace, try to add a second AI agent: you get the upgrade message.

## 8. Limitations and future work

- **Currency and tax:** one currency (USD); no tax/VAT calculation (Stripe Tax could be switched on) and no coupons beyond Stripe's promotion codes in Checkout.
- **Usage measurement:** AI replies are counted per calendar month (UTC), not per billing period.
- **Limit coverage:** limits apply to new items; a workspace already above a plan (e.g. after an admin edits data) is not cut back.
- **Untested against live Stripe:** the flow was tested with a fake Stripe client and signed test webhooks, not a live Stripe test account. Running it once with test keys is the next step (OPS-18).
- **Grandfathered workspaces:** workspaces created before billing have no limits until they choose a plan, by design for existing data.

## 9. File map

| Area | Files |
|---|---|
| Plans | `src/lib/billing-plans.ts` |
| Service | `src/lib/billing.ts` (effective plan, usage, limits, trial, checkout, change, cancel, portal, TEST provider, maintenance, Stripe sync and webhook handling) |
| APIs | `app/api/billing/route.ts`, `app/api/billing/[action]/route.ts`, `app/api/billing/webhook/route.ts`, `app/api/billing/invoices/[id]/route.ts` |
| Limits | `app/api/{ai-agents,chatbots,knowledge-sources,users}/route.ts`, `src/lib/conversation-runtime.ts`, `src/lib/ticket-workflow.ts` |
| Trial & jobs | `app/api/auth/signup/route.ts`, `instrumentation.ts`, `app/api/cron/sessions/route.ts` |
| UI | `app/dashboard/billing/page.tsx`, `src/components/dashboard/billing-workspace.tsx`, sidebar entry |
| Data | `prisma/schema.prisma`, `prisma/migrations/20261116090000_module3_billing/` |
| Tests | `tests/unit/billing.test.ts`, `tests/integration/billing.int.ts`, `tests/integration/billing-stripe.int.ts`, `tests/ui/billing.spec.ts` |
