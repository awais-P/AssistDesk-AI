import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../app/generated/prisma/client";

// `next build` loads every route module to collect page data but never queries the
// database, and hosts such as Railway don't expose the private database address while
// building. A placeholder lets the build finish; no connection is opened until a query runs.
const isBuild = process.env.NEXT_PHASE === "phase-production-build";
const connectionString =
  process.env.DATABASE_URL || (isBuild ? "postgresql://build:build@localhost:5432/build" : undefined);

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured.");
}

const adapter = new PrismaPg({ connectionString });

function createPrismaClient() {
  return new PrismaClient({
    adapter,
    log: ["warn", "error"],
    // Secrets are never returned unless a query opts in with `omit: { field: false }`.
    omit: {
      aIAgent: { apiKey: true },
      inbox: { smtpPassword: true },
      user: { passwordHash: true },
    } as const,
  });
}

type AppPrismaClient = ReturnType<typeof createPrismaClient>;

declare global {
  var prisma: AppPrismaClient | undefined;
}

const existingClient = global.prisma;

function hasRequiredDelegates(client: AppPrismaClient) {
  return (
    "session" in client &&
    "agentAutomation" in client &&
    "ticketMessage" in client &&
    "automationLog" in client &&
    "integration" in client &&
    "knowledgeChunk" in client &&
    "notification" in client &&
    "promptTemplate" in client
  );
}

export const prisma =
  existingClient && hasRequiredDelegates(existingClient)
    ? existingClient
    : createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
