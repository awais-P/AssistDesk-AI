import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../app/generated/prisma/client";

declare global {
  var prisma: PrismaClient | undefined;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured.");
}

const adapter = new PrismaPg({ connectionString });

function createPrismaClient() {
  return new PrismaClient({
    adapter,
    log: ["warn", "error"],
  });
}

const existingClient = global.prisma;

export const prisma =
  existingClient &&
  "session" in existingClient &&
  "agentAutomation" in existingClient &&
  "ticketMessage" in existingClient &&
  "automationLog" in existingClient
    ? existingClient
    : createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
