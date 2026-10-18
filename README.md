This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

# AssistDesk AI

AssistDesk is a Next.js customer-support workspace using Prisma, PostgreSQL, AI agents, tickets, chat sessions, knowledge sources, integrations, and an embeddable website widget.

## Complete Local Setup

### Prerequisites

Install Node.js 20 or newer, npm, Docker Desktop with Docker Compose, and Git. Node.js 22 LTS is recommended. Verify the tools in PowerShell:

```powershell
node --version
npm --version
docker --version
docker compose version
```

### Install Dependencies

Run from the repository directory:

```powershell
npm ci
Copy-Item .env.example .env
```

Open `.env` and set these required local values:

```env
DATABASE_URL="postgresql://assistdesk:assistdesk-dev-password@localhost:5433/assistdesk?schema=public"
ASSISTDESK_ENCRYPTION_KEY="local-development-key-at-least-32-characters"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

The complete optional variable list is in [.env.example](.env.example). Never commit `.env`.

### Start PostgreSQL

The repository includes [docker-compose.yml](docker-compose.yml). It runs PostgreSQL 16 with persistent storage on host port `5433`; port `5432` is commonly occupied by a local PostgreSQL installation.

```powershell
docker compose up -d
docker compose ps
```

Wait for the service to show `healthy`, then generate the Prisma client and apply the database migrations:

```powershell
npx prisma generate
npx prisma migrate deploy
```

The database persists in the `assistdesk-postgres-data` Docker volume (Compose prefixes the volume with the project name). Stop it without deleting data using `docker compose down`. To reset the local database completely, use `docker compose down -v` followed by `docker compose up -d` and `npx prisma migrate deploy`.

### Start AssistDesk

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Keep Docker PostgreSQL running while using the app. Stop the development server with `Ctrl+C`.

## Optional AI and Integrations

AI replies and knowledge-base features require at least one provider key in `.env`:

```env
ASSISTDESK_DEFAULT_GROQ_API_KEY="..."
ASSISTDESK_DEFAULT_GOOGLE_API_KEY="..."
ASSISTDESK_DEFAULT_OPENROUTER_API_KEY="..."
```

Email, Cloudinary, Pinecone, WhatsApp, and Firecrawl settings are optional and documented in [.env.example](.env.example). For a local demo workspace, set `ASSISTDESK_SEED_DEMO="true"` and a development-only `ASSISTDESK_DEMO_PASSWORD`.

## Commands

```powershell
npm run dev               # Development server
npm run build             # Production build
npm run start             # Start a production build
npm run lint              # ESLint
npm test                  # Unit tests
npm run test:watch        # Unit tests in watch mode
npm run test:integration  # Integration tests with a throwaway database
npx prisma generate       # Generate Prisma client
npx prisma migrate deploy # Apply committed migrations
```

Before a production build, run:

```powershell
npm run lint
npm test
npm run build
```

## Integration Tests

Integration tests modify their database. Use a local development or throwaway
database, never production. In PowerShell, load the local test environment into
the current session with:

```powershell
. .\scripts\tests-env.ps1
```

The leading dot and space are required. Dot-source the loader again whenever
you open a new PowerShell window. The file is ignored by Git and must never
contain production credentials.

```powershell
npx prisma migrate deploy
npm run test:integration
```

See [scripts/e2e/README.md](scripts/e2e/README.md) for end-to-end test requirements.

## Troubleshooting

For Prisma `P1000` errors, confirm `.env` uses port `5433` and the Compose credentials shown above. Restart with `docker compose up -d` and retry `npx prisma migrate deploy`. If the database has no data you need, reset it with `docker compose down -v`.

If port `5433` is busy, change the host side of the mapping in [docker-compose.yml](docker-compose.yml), for example to `5434:5432`, and use the same port in `DATABASE_URL`.
