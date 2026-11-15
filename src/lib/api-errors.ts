/**
 * Turns an error caught in a route into a message that is safe to show the user (SEC-16).
 *
 * Validation errors thrown on purpose ("Files must be 10 MB or smaller.") are passed through.
 * Database, file-system and other internal errors would reveal table names, field names or
 * server paths, so they are logged on the server and replaced by `fallback`.
 */
export function publicErrorMessage(error: unknown, fallback: string, context = "api") {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const code = (error as { code?: unknown }).code;
  const internal =
    error.name.startsWith("PrismaClient") ||
    (typeof code === "string" && (/^P\d{4}$/.test(code) || /^E[A-Z]+$/.test(code))) ||
    "syscall" in error ||
    "errno" in error ||
    /prisma|invocation|\n/i.test(error.message) ||
    error.message.length > 300;

  if (internal) {
    console.error(`[${context}]`, error);
    return fallback;
  }

  return error.message;
}
