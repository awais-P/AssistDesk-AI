# Deploying AssistDesk on Railway

Production runs from the **`main`** branch on [Railway](https://railway.com): one Node.js service (`next start`) and one PostgreSQL database. Every push to `main` deploys automatically; database migrations run before the new version starts.

> Railway's `railway.json` "config as code" is being retired (no new services), so the settings below are made once in the Railway dashboard.

## 1. Create the project

1. Railway → **New** → **Deploy from GitHub repo** → choose `AssistDesk-AI`. Allow the Railway GitHub app to see the repository if asked.
2. In the new project: **New** → **Database** → **PostgreSQL**.
3. Before the first build finishes, add the variables in step 2 (the build needs some of them). If the first build already failed, it redeploys when you save the variables.

## 2. Variables (app service → Variables)

**Required**

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway fills in the database's private address) |
| `ASSISTDESK_ENCRYPTION_KEY` | A new random secret, never the development one: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Changing it later makes saved API keys and channel tokens unreadable. |
| `NEXT_PUBLIC_APP_URL` | The public address from step 3, e.g. `https://assistdesk-production.up.railway.app` (used in emails and the widget snippet; it is built into the app, so redeploy after changing it) |
| `CRON_SECRET` | Another random secret (protects `/api/cron/*`) |
| `ASSISTDESK_SMTP_HOST`, `ASSISTDESK_SMTP_PORT`, `ASSISTDESK_SMTP_SECURE`, `ASSISTDESK_SMTP_USER`, `ASSISTDESK_SMTP_PASSWORD`, `ASSISTDESK_SMTP_FROM` | The account that sends verification, password-reset and notification emails. **Sign-in needs a verified email**, so without this nobody can log in a second time. Gmail: `smtp.gmail.com`, `465`, `true`, your address, an [app password](https://myaccount.google.com/apppasswords), your address. |
| At least one AI key: `ASSISTDESK_DEFAULT_GROQ_API_KEY` (fastest, free), `ASSISTDESK_DEFAULT_OPENROUTER_API_KEY`, `ASSISTDESK_DEFAULT_GOOGLE_API_KEY` | The managed models used by agents on the "Default" provider |

**Optional**

| Variable | When |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Billing (Module 3). Use Stripe **test** keys for the FYP: payments work with Stripe's test cards. Without them payments are off and workspaces have no plan limits. Webhook endpoint: `https://<your address>/api/billing/webhook` with the events listed in M3_SUBSCRIPTION_PAYMENT.md §3. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Avatars and chat attachments in Cloudinary instead of the volume |
| `PINECONE_API_KEY`, `PINECONE_INDEX`, `FIRECRAWL_API_KEY` | Pinecone vectors and Firecrawl crawling (Module 10) |
| `NODE_OPTIONS` = `--max-old-space-size=4096` | Only if the build fails with "JavaScript heap out of memory" |

**Leave unset in production:** `ASSISTDESK_SEED_DEMO`, `ASSISTDESK_DEMO_PASSWORD`, `ASSISTDESK_ALLOW_PRIVATE_TOOLS`, `ASSISTDESK_ALLOW_PRIVATE_WEBHOOKS`, `ASSISTDESK_SAMPLE_STORE`, `ASSISTDESK_BILLING_TEST_MODE`.

## 3. Service settings (app service → Settings)

| Setting | Value |
|---|---|
| Source → Branch | `main` |
| Build → Custom build command | leave empty (`npm run build` runs `prisma generate && next build`) |
| Deploy → Pre-deploy command | `npx prisma migrate deploy` |
| Deploy → Custom start command | `npm run start` |
| Deploy → Healthcheck path | `/api/health` |
| Networking → Public networking | **Generate domain** (then put it in `NEXT_PUBLIC_APP_URL`) |

**Volume for uploaded files:** right-click the app service → **Attach volume**, mount path **`/app/storage`**. Knowledge-base files (and chat attachments without Cloudinary) are saved there; without a volume they disappear on every deploy.

## 4. Check the deployment

1. `https://<your address>/api/health` answers `{"ok":true}`.
2. Sign up with a real email address; the verification email arrives; sign out and sign in again.
3. Create an agent and a chatbot, open the widget snippet on a test page, and ask a question.
4. Railway → app service → **Logs**: no `[secrets]`, `[jobs]` or `[mailer]` errors. The background jobs (session expiry, webhook retries, ticket follow-ups, Gmail checks, escalation SLA, billing) run inside the server, so no scheduler is needed.

## 5. After going live

- **Channels:** WhatsApp callback `https://<your address>/api/integrations/whatsapp/webhook/<id>` (shown on the Integrations page), Slack events URL, email forwarding to `/api/integrations/email/inbound`.
- **Stripe:** webhook endpoint as above.
- **Updates:** merge into `main` → Railway builds, runs migrations, checks `/api/health`, then switches traffic. A failed health check keeps the previous version running.
- **Costs:** the app and the database both run all the time. Watch **Usage** in Railway; the trial ($5 or 30 days) is followed by the Hobby plan (about $5 a month).
- **Backups:** Railway's PostgreSQL → Backups (or `pg_dump` with the public connection string) before big changes.
