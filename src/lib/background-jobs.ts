import { recoverStaleKnowledgeJobs } from "./knowledge-indexing";
import { consumeRateLimit } from "./rate-limit";
import { expireIdleSessions } from "./session-lifecycle";
import { runTicketInactivityAutomations } from "./ticket-inactivity";
import { expireStaleConfirmations } from "./tools/registry";
import { processDueDeliveries } from "./webhooks";

/**
 * The periodic jobs that used to run only when someone called `/api/cron/*` (OPS-13):
 * - idle-session expiry (Module 5 FE-5);
 * - stale action confirmations (Module 2);
 * - knowledge-indexing recovery (Module 10 FE-4);
 * - lead-webhook retries (Module 8 CI-3);
 * - the "AI Follow-up" and "Close Ticket" automations.
 *
 * The server starts this every 5 minutes from `instrumentation.ts`, so nothing needs to be
 * scheduled for a normal server. On serverless hosting the same work runs from the cron
 * routes (`vercel.json`). With several server instances, a database lease lets only one
 * of them run each round.
 */

const INTERVAL_MS = 5 * 60 * 1000;
const LEASE = { limit: 1, windowSeconds: 4 * 60 };

type JobResult = Record<string, number | string>;

declare global {
  var assistdeskBackgroundJobsTimer: ReturnType<typeof setInterval> | undefined;
}

async function step(results: JobResult, name: string, job: () => Promise<number>) {
  try {
    results[name] = await job();
  } catch (error) {
    console.error(`[jobs] ${name} failed:`, error);
    results[name] = "failed";
  }
}

/** One round of every job. Each job is isolated: one failing never stops the others. */
export async function runBackgroundJobs() {
  const results: JobResult = {};
  await step(results, "expiredSessions", () => expireIdleSessions({ limit: 100 }));
  await step(results, "expiredConfirmations", () => expireStaleConfirmations());
  await step(results, "requeuedKnowledgeJobs", () => recoverStaleKnowledgeJobs(undefined, 20));
  await step(results, "webhookDeliveries", () => processDueDeliveries({ limit: 50 }));
  await step(results, "ticketFollowUps", async () => {
    const inactivity = await runTicketInactivityAutomations();
    results.ticketsClosed = inactivity.closed;
    return inactivity.followUps;
  });
  return results;
}

/** Runs a round unless another server instance already ran one in the last 4 minutes. */
export async function runBackgroundJobsOnce() {
  const lease = await consumeRateLimit("jobs:background", LEASE);

  if (!lease.allowed) {
    return null;
  }

  return runBackgroundJobs();
}

export function startBackgroundJobs() {
  if (globalThis.assistdeskBackgroundJobsTimer || process.env.ASSISTDESK_BACKGROUND_JOBS === "false") {
    return;
  }

  globalThis.assistdeskBackgroundJobsTimer = setInterval(() => {
    void runBackgroundJobsOnce().catch((error) => console.error("[jobs] round failed:", error));
  }, INTERVAL_MS);
  // Never keep a script or test process alive just for this timer.
  globalThis.assistdeskBackgroundJobsTimer.unref?.();
}
