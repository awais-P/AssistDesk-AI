import { NextResponse } from "next/server";
import { requirePermission } from "@/src/lib/access";
import { auditUser } from "@/src/lib/audit";
import { getCurrentSession } from "@/src/lib/auth";
import { ESCALATION_ROUTINGS, type EscalationRouting } from "@/src/lib/escalation-routing";
import { normalizeEmail } from "@/src/lib/identity";
import { isPlatformEmailConfigured } from "@/src/lib/mailer";
import { can } from "@/src/lib/permissions";
import { PRESENCE_WINDOW_MS } from "@/src/lib/presence";
import { prisma } from "@/src/lib/prisma";
import { encryptSecret } from "@/src/lib/secrets";
import { SLACK_WEBHOOK_PATTERN, maskSlackUrl } from "@/src/lib/slack-webhook";

const MAX_NOTIFY_EMAILS = 10;
const MAX_ROUTING_MEMBERS = 50;

async function readAlertSettings(workspaceId: string) {
  const [settings, users] = await Promise.all([
    prisma.workspaceSetting.findUnique({
      where: { workspaceId },
      select: {
        escalationNotifyEmails: true,
        escalationSlackWebhookUrl: true,
        escalationAlertUrgentOnly: true,
        escalationRouting: true,
        escalationRoutingUserIds: true,
        escalationRoutingOnlineOnly: true,
      },
    }),
    prisma.user.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, role: true, lastSeenAt: true, customRole: { select: { permissions: true, deniedPermissions: true } } },
    }),
  ]);
  const onlineSince = Date.now() - PRESENCE_WINDOW_MS;

  return {
    settings: {
      notifyEmails: settings?.escalationNotifyEmails ?? [],
      slackWebhookUrl: maskSlackUrl(settings?.escalationSlackWebhookUrl),
      slackConfigured: Boolean(settings?.escalationSlackWebhookUrl),
      urgentOnly: settings?.escalationAlertUrgentOnly ?? false,
      routing: (settings?.escalationRouting ?? "QUEUE") as EscalationRouting,
      routingUserIds: settings?.escalationRoutingUserIds ?? [],
      onlineOnly: settings?.escalationRoutingOnlineOnly ?? true,
      emailConfigured: isPlatformEmailConfigured(),
    },
    // Only people who may handle conversations can be in the rotation.
    members: users
      .filter((user) => can(user, "tickets.handle"))
      .map((user) => ({ id: user.id, fullName: user.fullName, role: user.role, online: Boolean(user.lastSeenAt && user.lastSeenAt.getTime() >= onlineSince) })),
  };
}

/** Module 9: escalation alerts (email, Slack) and routing (shared queue or round-robin). */
export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json(await readAlertSettings(session.user.workspaceId));
}

type AlertPayload = {
  notifyEmails?: unknown;
  slackWebhookUrl?: unknown;
  urgentOnly?: unknown;
  routing?: unknown;
  routingUserIds?: unknown;
  onlineOnly?: unknown;
};

export async function PATCH(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "escalations.settings", request);

  if (forbidden) {
    return forbidden;
  }

  const { workspaceId } = session.user;
  const body = (await request.json().catch(() => ({}))) as AlertPayload;
  const data: {
    escalationNotifyEmails?: string[];
    escalationSlackWebhookUrl?: string | null;
    escalationAlertUrgentOnly?: boolean;
    escalationRouting?: EscalationRouting;
    escalationRoutingUserIds?: string[];
    escalationRoutingOnlineOnly?: boolean;
  } = {};

  if (body.notifyEmails !== undefined) {
    if (!Array.isArray(body.notifyEmails)) {
      return NextResponse.json({ error: "Alert emails must be a list." }, { status: 400 });
    }

    const emails = [...new Set(body.notifyEmails.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean))];
    const invalid = emails.filter((email) => !normalizeEmail(email));

    if (invalid.length > 0) {
      return NextResponse.json({ error: `Not a valid email: ${invalid.join(", ")}` }, { status: 400 });
    }

    if (emails.length > MAX_NOTIFY_EMAILS) {
      return NextResponse.json({ error: `Up to ${MAX_NOTIFY_EMAILS} alert emails.` }, { status: 400 });
    }

    data.escalationNotifyEmails = [...new Set(emails.map((email) => normalizeEmail(email) as string))];
  }

  if (body.slackWebhookUrl !== undefined) {
    const url = typeof body.slackWebhookUrl === "string" ? body.slackWebhookUrl.trim() : "";

    if (url && !SLACK_WEBHOOK_PATTERN.test(url)) {
      return NextResponse.json({ error: "Paste a Slack incoming-webhook URL, like https://hooks.slack.com/services/T000/B000/XXXX." }, { status: 400 });
    }

    data.escalationSlackWebhookUrl = url ? encryptSecret(url) : null;
  }

  for (const [key, field] of [
    ["urgentOnly", "escalationAlertUrgentOnly"],
    ["onlineOnly", "escalationRoutingOnlineOnly"],
  ] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "boolean") {
        return NextResponse.json({ error: `${key} must be true or false.` }, { status: 400 });
      }
      data[field] = body[key] as boolean;
    }
  }

  if (body.routing !== undefined) {
    if (!ESCALATION_ROUTINGS.includes(body.routing as EscalationRouting)) {
      return NextResponse.json({ error: 'Routing must be "QUEUE" or "ROUND_ROBIN".' }, { status: 400 });
    }
    data.escalationRouting = body.routing as EscalationRouting;
  }

  if (body.routingUserIds !== undefined) {
    if (!Array.isArray(body.routingUserIds) || body.routingUserIds.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "Routing members must be a list of team member ids." }, { status: 400 });
    }

    const ids = [...new Set(body.routingUserIds as string[])];

    if (ids.length > MAX_ROUTING_MEMBERS) {
      return NextResponse.json({ error: `Up to ${MAX_ROUTING_MEMBERS} people in the rotation.` }, { status: 400 });
    }

    // Only active members of this workspace.
    const found = await prisma.user.count({ where: { id: { in: ids }, workspaceId, isActive: true } });

    if (found !== ids.length) {
      return NextResponse.json({ error: "Choose active members of this workspace." }, { status: 400 });
    }

    data.escalationRoutingUserIds = ids;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  await prisma.workspaceSetting.upsert({ where: { workspaceId }, update: data, create: { workspaceId, ...data }, select: { id: true } });
  await auditUser(session.user, {
    action: "settings.escalation_alerts_updated",
    category: "settings",
    summary: `${session.user.fullName} changed the escalation alerts and routing`,
    // The Slack URL is a secret: only say that it changed.
    metadata: { fields: Object.keys(data), ...(data.escalationRouting ? { routing: data.escalationRouting } : {}) },
    request,
  });

  return NextResponse.json(await readAlertSettings(workspaceId));
}
