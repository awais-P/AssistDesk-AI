import { decryptSecret } from "./secrets";

/**
 * Slack incoming webhooks, shared by the lead alerts (Module 8 FE-3) and the escalation
 * alerts (Module 9). Only hooks.slack.com URLs are accepted, so a saved URL can't be used
 * to reach any other host.
 */
export const SLACK_WEBHOOK_PATTERN = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/;

/** The stored (encrypted) URL, shown with only its last characters. */
export function maskSlackUrl(stored: string | null | undefined) {
  const url = decryptSecret(stored ?? null);
  return url ? `https://hooks.slack.com/services/…${url.slice(-6)}` : null;
}

export async function postToSlack(webhookUrl: string, text: string) {
  if (!/^https:\/\/hooks\.slack\.com\/services\//.test(webhookUrl)) {
    throw new Error("The Slack URL must be an incoming-webhook URL (https://hooks.slack.com/services/…).");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Slack answered HTTP ${response.status}.`);
  }
}
