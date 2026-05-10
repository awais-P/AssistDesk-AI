import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/src/generated/client";

declare global {
  var prisma: PrismaClient | undefined;
}

let prismaClient: PrismaClient | undefined;

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: ["warn", "error"],
  });
}

function getPrismaClient() {
  const existingClient = prismaClient ?? global.prisma;

  if (
    existingClient &&
    "session" in existingClient &&
    "agentAutomation" in existingClient
  ) {
    prismaClient = existingClient;
    return existingClient;
  }

  prismaClient = createPrismaClient();

  if (process.env.NODE_ENV !== "production") {
    global.prisma = prismaClient;
  }

  return prismaClient;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
});
