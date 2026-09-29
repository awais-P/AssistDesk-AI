import { NextResponse, after } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { ingestIncomingEmail, runEmailAutomation } from "@/src/lib/email-ingestion";
import { RATE_LIMITS, consumeRateLimit, tooManyRequests } from "@/src/lib/rate-limit";

type IncomingEmailPayload = {
  supportAddress?: unknown;
  forwardingAddress?: unknown;
  fromName?: unknown;
  fromEmail?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
  messageId?: unknown;
  secret?: unknown;
};

const MAX_BODY_BYTES = 1_000_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/**
 * Inbound email webhook. The integration's webhook secret is REQUIRED (header
 * `x-assistdesk-secret` or `secret` in the body); knowing a public support address
 * is no longer enough to create tickets in someone's workspace.
 *
 * Replies to our emails (subject contains `[PREFIX-NUMBER]`) are threaded into their
 * ticket; `messageId` (the email's Message-ID) deduplicates provider retries. The AI
 * workflow runs after the response, so the provider is never kept waiting.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Email payload is too large." }, { status: 413 });
  }

  let body: IncomingEmailPayload;

  try {
    body = JSON.parse(rawBody) as IncomingEmailPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const secret = request.headers.get("x-assistdesk-secret")?.trim() || text(body.secret, 200);
  const fromEmail = text(body.fromEmail, 200).toLowerCase();
  const subject = text(body.subject, 300);

  if (!secret) {
    return NextResponse.json(
      { error: "Missing webhook secret. Send it in the x-assistdesk-secret header." },
      { status: 401 },
    );
  }

  if (!fromEmail || !EMAIL_PATTERN.test(fromEmail) || !subject) {
    return NextResponse.json(
      { error: "A valid fromEmail and a subject are required." },
      { status: 400 },
    );
  }

  const integration = await prisma.integration.findFirst({
    where: {
      type: "EMAIL",
      isActive: true,
      status: "CONNECTED",
      webhookSecret: secret,
    },
    select: {
      id: true,
      workspaceId: true,
      inboxId: true,
      supportAddress: true,
      forwardingAddress: true,
    },
  });

  if (!integration) {
    return NextResponse.json(
      { error: "Invalid webhook secret or the email integration is disabled." },
      { status: 401 },
    );
  }

  const limit = await consumeRateLimit(
    `email-inbound:${integration.id}`,
    RATE_LIMITS.emailInboundPerIntegration,
  );

  if (!limit.allowed) {
    return tooManyRequests(limit, "Too many inbound emails for this integration. Retry later.");
  }

  const result = await ingestIncomingEmail({
    integration,
    payload: {
      fromName: text(body.fromName, 120) || null,
      fromEmail,
      subject,
      text: text(body.text, 100_000) || null,
      html: text(body.html, 200_000) || null,
      messageId: text(body.messageId, 300) || request.headers.get("x-assistdesk-message-id"),
    },
  });

  after(async () => {
    try {
      await runEmailAutomation(result);
    } catch (error) {
      console.error("[email] AI workflow failed:", error);
    }
  });

  return NextResponse.json({
    success: true,
    ticketId: result.ticket.id,
    ticketNumber: result.ticket.ticketNumber,
    outcome: result.outcome,
  });
}
