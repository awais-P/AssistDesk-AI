import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { normalizeEmail } from "@/src/lib/identity";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";
import { decryptSecret, encryptSecret } from "@/src/lib/secrets";

const MAX_NOTIFY_EMAILS = 10;
const SLACK_WEBHOOK_PATTERN = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/;

function maskSlackUrl(stored: string | null) {
  const url = decryptSecret(stored);
  return url ? `https://hooks.slack.com/services/…${url.slice(-6)}` : null;
}

async function readSettings(workspaceId: string) {
  const settings = await prisma.workspaceSetting.findUnique({
    where: { workspaceId },
    select: { leadNotifyEmails: true, leadSlackWebhookUrl: true, autoCaptureLeads: true },
  });

  return {
    notifyEmails: settings?.leadNotifyEmails ?? [],
    slackWebhookUrl: maskSlackUrl(settings?.leadSlackWebhookUrl ?? null),
    slackConfigured: Boolean(settings?.leadSlackWebhookUrl),
    autoCaptureLeads: settings?.autoCaptureLeads !== false,
    emailConfigured: Boolean(process.env.ASSISTDESK_SMTP_HOST?.trim()),
  };
}

/** Lead notification settings (Module 8 FE-3) and automatic capture (FE-2). */
export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({ settings: await readSettings(session.user.workspaceId) });
}

type SettingsPayload = {
  notifyEmails?: unknown;
  slackWebhookUrl?: unknown;
  autoCaptureLeads?: unknown;
};

export async function PATCH(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const body = (await request.json().catch(() => ({}))) as SettingsPayload;
  const data: { leadNotifyEmails?: string[]; leadSlackWebhookUrl?: string | null; autoCaptureLeads?: boolean } = {};

  if (body.notifyEmails !== undefined) {
    if (!Array.isArray(body.notifyEmails)) {
      return NextResponse.json({ error: "Notification emails must be a list." }, { status: 400 });
    }

    const emails = [...new Set(body.notifyEmails.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean))];
    const invalid = emails.filter((email) => !normalizeEmail(email));

    if (invalid.length > 0) {
      return NextResponse.json({ error: `Not a valid email: ${invalid.join(", ")}` }, { status: 400 });
    }

    if (emails.length > MAX_NOTIFY_EMAILS) {
      return NextResponse.json({ error: `Up to ${MAX_NOTIFY_EMAILS} notification emails.` }, { status: 400 });
    }

    data.leadNotifyEmails = emails.map((email) => normalizeEmail(email) as string);
  }

  if (body.slackWebhookUrl !== undefined) {
    const url = typeof body.slackWebhookUrl === "string" ? body.slackWebhookUrl.trim() : "";

    if (url && !SLACK_WEBHOOK_PATTERN.test(url)) {
      return NextResponse.json(
        { error: "Paste a Slack incoming-webhook URL, like https://hooks.slack.com/services/T000/B000/XXXX." },
        { status: 400 },
      );
    }

    data.leadSlackWebhookUrl = url ? encryptSecret(url) : null;
  }

  if (body.autoCaptureLeads !== undefined) {
    if (typeof body.autoCaptureLeads !== "boolean") {
      return NextResponse.json({ error: "autoCaptureLeads must be true or false." }, { status: 400 });
    }

    data.autoCaptureLeads = body.autoCaptureLeads;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  await prisma.workspaceSetting.upsert({
    where: { workspaceId: session.user.workspaceId },
    update: data,
    create: { workspaceId: session.user.workspaceId, ...data },
  });

  return NextResponse.json({ settings: await readSettings(session.user.workspaceId) });
}
