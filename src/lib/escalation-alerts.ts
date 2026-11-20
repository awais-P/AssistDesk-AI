import { getAppUrl } from "./llm-runtime";
import { sendTeamEmail } from "./mailer";
import { createNotification } from "./notifications";
import { prisma } from "./prisma";
import { decryptSecret } from "./secrets";
import { channelLabel } from "./session-memory";
import { postToSlack } from "./slack-webhook";

/**
 * Module 9: tells the team about escalations outside the dashboard, by email and Slack
 * (the same channels as the lead alerts of Module 8):
 *   - a new escalation (or only HIGH/URGENT ones, if the workspace chose that);
 *   - an escalation nobody accepted before its deadline (always).
 * When round-robin routing picked someone, they are also emailed personally.
 * A channel that fails raises one dashboard warning an hour.
 */
export type EscalationAlert = {
  kind: "created" | "sla_breached";
  escalationId: string;
  customer: string;
  channel: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  triggerLabel: string;
  reason: string;
  assignee: { fullName: string; email: string } | null;
  slaMinutes?: number | null;
  waitedMinutes?: number;
};

export type AlertResult = { channel: "email" | "slack" | "assignee"; ok: boolean; detail: string };

const PRIORITY_WORD: Record<EscalationAlert["priority"], string> = { LOW: "Low priority", MEDIUM: "Medium priority", HIGH: "High priority", URGENT: "Urgent" };

export function escalationAlertText(alert: EscalationAlert) {
  const link = `${getAppUrl()}/dashboard/escalations?id=${alert.escalationId}`;
  const owner = alert.assignee
    ? alert.kind === "created"
      ? `Assigned to ${alert.assignee.fullName} (waiting for them to accept).`
      : `Assigned to ${alert.assignee.fullName}, who hasn't accepted it yet.`
    : alert.kind === "created"
      ? `Waiting in the queue${alert.slaMinutes ? `: accept within ${alert.slaMinutes} min` : ""}.`
      : "Nobody has accepted it yet.";

  const subject =
    alert.kind === "created"
      ? `${alert.priority === "URGENT" ? "Urgent escalation" : "Escalation"}: ${alert.customer} on ${channelLabel(alert.channel)}`
      : `Overdue escalation: ${alert.customer} has waited ${alert.waitedMinutes ?? "?"} min for a person`;

  const text = [
    subject,
    `${PRIORITY_WORD[alert.priority]} · ${alert.triggerLabel}: ${alert.reason}`,
    owner,
    link,
  ].join("\n");

  return { subject, text };
}

export async function sendEscalationAlerts(workspaceId: string, alert: EscalationAlert, { test = false } = {}) {
  const settings = await prisma.workspaceSetting.findUnique({
    where: { workspaceId },
    select: { escalationNotifyEmails: true, escalationSlackWebhookUrl: true, escalationAlertUrgentOnly: true },
  });
  const { subject, text } = escalationAlertText(alert);
  const prefix = test ? "[Test] " : "";
  const results: AlertResult[] = [];
  const teamAlert =
    test || alert.kind === "sla_breached" || !settings?.escalationAlertUrgentOnly || alert.priority === "HIGH" || alert.priority === "URGENT";
  const emails = settings?.escalationNotifyEmails ?? [];

  if (teamAlert && emails.length > 0) {
    const email = await sendTeamEmail({ to: emails, subject: `${prefix}${subject}`, text: `${prefix}${text}` });
    results.push({
      channel: "email",
      ok: email.status === "SENT",
      detail: email.status === "SENT" ? `Emailed ${emails.length} recipient(s)` : (email.error ?? email.status),
    });
  }

  const slackUrl = teamAlert ? decryptSecret(settings?.escalationSlackWebhookUrl ?? null) : null;

  if (slackUrl) {
    try {
      await postToSlack(slackUrl, `${prefix}${text}`);
      results.push({ channel: "slack", ok: true, detail: "Posted to Slack" });
    } catch (error) {
      results.push({ channel: "slack", ok: false, detail: error instanceof Error ? error.message : "Slack failed" });
    }
  }

  // The person round-robin picked, unless the team email already reached them.
  const assigneeEmail = alert.assignee?.email?.toLowerCase();

  if (alert.kind === "created" && !test && assigneeEmail && !(teamAlert && emails.includes(assigneeEmail))) {
    const personal = await sendTeamEmail({
      to: [assigneeEmail],
      subject: `An escalation was assigned to you: ${alert.customer}`,
      text: `Hi ${alert.assignee!.fullName},\n\n${text}\n\nOpen it and press Accept to take the conversation.`,
    });
    results.push({
      channel: "assignee",
      ok: personal.status === "SENT",
      detail: personal.status === "SENT" ? `Emailed ${alert.assignee!.fullName}` : (personal.error ?? personal.status),
    });
  }

  const failed = results.filter((result) => !result.ok);

  if (!test && failed.length > 0) {
    await createNotification({
      workspaceId,
      type: "ESCALATION_NOTIFY_FAILED",
      severity: "WARNING",
      title: "An escalation alert could not be sent",
      body: failed.map((result) => `${result.channel}: ${result.detail}`).join(" · ").slice(0, 300),
      link: "/dashboard/escalations/settings",
      dedupeMinutes: 60,
    });
  }

  return results;
}
