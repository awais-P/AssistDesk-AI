/**
 * Runs once when the server starts (Next.js instrumentation hook). Starts the background
 * check of connected mailboxes (Gmail), so emails become tickets without any command,
 * and the escalation response-time (SLA) check (Module 9).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startEmailPolling } = await import("./src/lib/email-mailbox");
    startEmailPolling();
    const { startEscalationSlaChecks } = await import("./src/lib/escalation");
    startEscalationSlaChecks();
  }
}
