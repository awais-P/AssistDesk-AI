import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../app/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

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
    "knowledgeChunk" in client
  );
}

export const prisma =
  existingClient && hasRequiredDelegates(existingClient)
    ? existingClient
    : createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
