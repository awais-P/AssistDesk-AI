/**
 * Runs once when the server starts (Next.js instrumentation hook). Starts the background
 * check of connected mailboxes (Gmail), so emails become tickets without any command,
 * the escalation response-time (SLA) check (Module 9) and, every 5 minutes, the other
 * background jobs (session expiry, knowledge recovery, webhook retries, ticket follow-ups).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startEmailPolling } = await import("./src/lib/email-mailbox");
    startEmailPolling();
    // Module 11: refused role checks are written to the audit log.
    await import("./src/lib/access");
    const { startEscalationSlaChecks } = await import("./src/lib/escalation");
    startEscalationSlaChecks();
    // Module 3: trial ends and test-mode renewals (Stripe renews real subscriptions).
    const { startBillingMaintenance } = await import("./src/lib/billing");
    startBillingMaintenance();
    // OPS-13: the jobs that used to wait for someone to call /api/cron/*.
    const { startBackgroundJobs } = await import("./src/lib/background-jobs");
    startBackgroundJobs();
  }
}
