/**
 * Runs once when the server starts (Next.js instrumentation hook). Starts the background
 * check of connected mailboxes (Gmail), so emails become tickets without any command.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startEmailPolling } = await import("./src/lib/email-mailbox");
    startEmailPolling();
  }
}
