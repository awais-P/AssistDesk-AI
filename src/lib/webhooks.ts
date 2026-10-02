import { createHmac, randomBytes } from "node:crypto";
import { after } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { createNotification } from "./notifications";
import { prisma } from "./prisma";
import { UnsafeUrlError, assertPublicUrl } from "./safe-fetch";
import { decryptSecret, encryptSecret, safeEqual } from "./secrets";

/**
 * Outgoing webhooks (Module 8 FE-4, SRS CI-3): lead data is pushed to the customer's
 * CRM or automation tool (Zapier, Make, HubSpot…).
 *
 * - Signed like Stripe: `X-AssistDesk-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`.
 * - `X-AssistDesk-Delivery` is a stable id, so receivers can ignore duplicates.
 * - Up to 3 retries on failure (SRS), with backoff: 30 s, 2 min, 10 min.
 * - Every attempt is logged (status code, response excerpt, error).
 * - URLs must be public (SSRF protection); redirects are not followed.
 */

/** `lead.deleted` lets a CRM delete its copy too (privacy requests). */
export const WEBHOOK_EVENTS = ["lead.created", "lead.updated", "lead.status_changed", "lead.deleted"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "webhook.test";

/** Delay before retry 1, 2 and 3. */
export const RETRY_DELAYS_SECONDS = [30, 120, 600];
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;
const DELIVERY_TIMEOUT_MS = 10_000;
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function generateWebhookSecret() {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function signWebhookPayload(secret: string, timestamp: number, body: string) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/** Reference implementation for receivers (also used in tests and the docs). */
export function verifyWebhookSignature({
  secret,
  header,
  body,
  now = Date.now(),
}: {
  secret: string;
  header: string | null;
  body: string;
  now?: number;
}) {
  const parts = Object.fromEntries(
    (header ?? "").split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = Number(parts.t);

  if (!Number.isFinite(timestamp) || !parts.v1) {
    return false;
  }

  if (Math.abs(Math.floor(now / 1000) - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  return safeEqual(signWebhookPayload(secret, timestamp, body), `t=${timestamp},v1=${parts.v1}`);
}

function allowPrivateTargets() {
  return process.env.NODE_ENV !== "production" && process.env.ASSISTDESK_ALLOW_PRIVATE_WEBHOOKS === "true";
}

/**
 * Checks a webhook URL an admin enters. HTTPS is required in production; local or
 * private addresses are refused (set ASSISTDESK_ALLOW_PRIVATE_WEBHOOKS=true to test
 * against a local receiver in development).
 */
export async function validateWebhookUrl(rawUrl: string) {
  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false as const, error: "Enter a valid URL, like https://example.com/webhooks/assistdesk." };
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && process.env.NODE_ENV !== "production")) {
    return { ok: false as const, error: "Webhook URLs must use https://." };
  }

  if (!allowPrivateTargets()) {
    try {
      await assertPublicUrl(url.toString());
    } catch (error) {
      return {
        ok: false as const,
        error:
          error instanceof UnsafeUrlError
            ? "This URL points to a local or private network address. Use a public URL."
            : "This URL could not be checked.",
      };
    }
  }

  return { ok: true as const, url: url.toString() };
}

export function maskWebhookSecret(stored: string) {
  const secret = decryptSecret(stored) ?? "";
  return secret ? `${secret.slice(0, 9)}…${secret.slice(-4)}` : "";
}

export function storeWebhookSecret(secret: string) {
  return encryptSecret(secret) ?? secret;
}

type DeliveryPayload = {
  id: string;
  event: WebhookEvent;
  createdAt: string;
  workspace: { id: string; name: string };
  data: Prisma.InputJsonValue;
};

/**
 * Queues `event` for every active endpoint of the workspace that subscribes to it and
 * sends the first attempt in the background.
 */
export async function enqueueWebhookEvent({
  workspaceId,
  event,
  leadId = null,
  data,
}: {
  workspaceId: string;
  event: Exclude<WebhookEvent, "webhook.test">;
  leadId?: string | null;
  data: Prisma.InputJsonValue;
}) {
  const [endpoints, workspace] = await Promise.all([
    prisma.webhookEndpoint.findMany({
      where: { workspaceId, isActive: true, events: { has: event } },
      select: { id: true },
    }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } }),
  ]);

  if (endpoints.length === 0 || !workspace) {
    return [];
  }

  const ids: string[] = [];

  for (const endpoint of endpoints) {
    const delivery = await prisma.webhookDelivery.create({
      data: { workspaceId, endpointId: endpoint.id, leadId, event, payload: {}, status: "PENDING" },
      select: { id: true, createdAt: true },
    });
    const payload: DeliveryPayload = {
      id: delivery.id,
      event,
      createdAt: delivery.createdAt.toISOString(),
      workspace,
      data,
    };

    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { payload: payload as unknown as Prisma.InputJsonValue },
      select: { id: true },
    });
    ids.push(delivery.id);
  }

  runInBackground(async () => {
    for (const id of ids) {
      await attemptDelivery(id);
    }
  });

  return ids;
}

function runInBackground(job: () => Promise<void>) {
  const wrapped = async () => {
    try {
      await job();
    } catch (error) {
      console.error("[webhooks] Background delivery failed:", error);
    }
  };

  try {
    after(wrapped);
  } catch {
    setTimeout(() => void wrapped(), 0);
  }
}

async function postSigned(url: string, secret: string, event: string, deliveryId: string, body: string) {
  const timestamp = Math.floor(Date.now() / 1000);

  if (!allowPrivateTargets()) {
    await assertPublicUrl(url);
  }

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "AssistDesk-Webhooks/1.0",
      "X-AssistDesk-Event": event,
      "X-AssistDesk-Delivery": deliveryId,
      "X-AssistDesk-Signature": signWebhookPayload(secret, timestamp, body),
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
}

function describeError(error: unknown) {
  if (error instanceof UnsafeUrlError) {
    return "The webhook URL now points to a private address and was blocked.";
  }

  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `No response within ${DELIVERY_TIMEOUT_MS / 1000} seconds.`;
  }

  return error instanceof Error ? error.message.slice(0, 300) : "Request failed.";
}

/** Sends one attempt of a delivery and schedules the next retry if it fails. */
export async function attemptDelivery(deliveryId: string) {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });

  if (!delivery || delivery.status === "SUCCESS" || delivery.attempts >= MAX_ATTEMPTS) {
    return delivery;
  }

  // Claim the attempt so a parallel sweep does not send it twice.
  const claimed = await prisma.webhookDelivery.updateMany({
    where: { id: delivery.id, attempts: delivery.attempts, status: { not: "SUCCESS" } },
    data: { attempts: { increment: 1 }, nextAttemptAt: null },
  });

  if (claimed.count === 0) {
    return delivery;
  }

  const attempt = delivery.attempts + 1;
  const secret = decryptSecret(delivery.endpoint.secret) ?? "";
  const body = JSON.stringify(delivery.payload);
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;

  try {
    const response = await postSigned(delivery.endpoint.url, secret, delivery.event, delivery.id, body);
    responseStatus = response.status;
    responseBody = (await response.text().catch(() => "")).slice(0, 500) || null;

    if (response.status >= 300) {
      error =
        response.status < 400
          ? `Redirects are not followed (HTTP ${response.status}).`
          : `The receiver answered HTTP ${response.status}.`;
    }
  } catch (caught) {
    error = describeError(caught);
  }

  const succeeded = !error;
  const finalFailure = !succeeded && attempt >= MAX_ATTEMPTS;
  const status = succeeded ? "SUCCESS" : finalFailure ? "FAILED" : "RETRYING";

  const updated = await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status,
      responseStatus,
      responseBody,
      error,
      deliveredAt: succeeded ? new Date() : null,
      nextAttemptAt: status === "RETRYING" ? new Date(Date.now() + RETRY_DELAYS_SECONDS[attempt - 1] * 1000) : null,
    },
  });

  await prisma.webhookEndpoint.update({
    where: { id: delivery.endpointId },
    data: { lastDeliveryAt: new Date(), lastStatus: succeeded ? `HTTP ${responseStatus}` : error?.slice(0, 120) },
    select: { id: true },
  });

  if (delivery.leadId && (succeeded || finalFailure)) {
    await prisma.leadEvent.create({
      data: {
        workspaceId: delivery.workspaceId,
        leadId: delivery.leadId,
        type: succeeded ? "WEBHOOK_DELIVERED" : "WEBHOOK_FAILED",
        detail: succeeded
          ? `Sent to ${delivery.endpoint.name} (HTTP ${responseStatus}${attempt > 1 ? `, attempt ${attempt}` : ""}).`
          : `Could not be sent to ${delivery.endpoint.name} after ${attempt} attempts: ${error}`,
        metadata: { deliveryId: delivery.id, endpointId: delivery.endpointId },
      },
    });
  }

  if (finalFailure) {
    await createNotification({
      workspaceId: delivery.workspaceId,
      type: "WEBHOOK_FAILED",
      severity: "ERROR",
      title: `Webhook "${delivery.endpoint.name}" failed`,
      body: `${delivery.event} could not be delivered after ${attempt} attempts: ${error}`.slice(0, 300),
      link: "/dashboard/leads/settings",
      dedupeMinutes: 30,
    });
  }

  return updated;
}

/** Sends retries that are due (cron, Leads page load, manual "Retry"). */
export async function processDueDeliveries({ workspaceId, limit = 20 }: { workspaceId?: string; limit?: number } = {}) {
  const due = await prisma.webhookDelivery.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      status: { in: ["PENDING", "RETRYING"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      // A PENDING delivery younger than a minute is still being sent by its request.
      NOT: { status: "PENDING", createdAt: { gt: new Date(Date.now() - 60_000) } },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  for (const delivery of due) {
    await attemptDelivery(delivery.id);
  }

  return due.length;
}

/** "Send test" from the settings page: one signed request, result returned directly. */
export async function sendTestWebhook(endpointId: string, workspaceId: string) {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, workspaceId },
    include: { workspace: { select: { id: true, name: true } } },
  });

  if (!endpoint) {
    return null;
  }

  const delivery = await prisma.webhookDelivery.create({
    data: { workspaceId, endpointId, event: "webhook.test", payload: {}, status: "PENDING", attempts: 1 },
    select: { id: true, createdAt: true },
  });
  const payload: DeliveryPayload = {
    id: delivery.id,
    event: "webhook.test",
    createdAt: delivery.createdAt.toISOString(),
    workspace: endpoint.workspace,
    data: {
      message: "This is a test event from AssistDesk. Verify the X-AssistDesk-Signature header with your signing secret.",
      lead: sampleLeadPayload(),
    },
  };
  const body = JSON.stringify(payload);
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;

  try {
    const response = await postSigned(endpoint.url, decryptSecret(endpoint.secret) ?? "", "webhook.test", delivery.id, body);
    responseStatus = response.status;
    responseBody = (await response.text().catch(() => "")).slice(0, 500) || null;
    error = response.status >= 300 ? `The receiver answered HTTP ${response.status}.` : null;
  } catch (caught) {
    error = describeError(caught);
  }

  const result = await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      payload: payload as unknown as Prisma.InputJsonValue,
      status: error ? "FAILED" : "SUCCESS",
      responseStatus,
      responseBody,
      error,
      deliveredAt: error ? null : new Date(),
    },
  });

  await prisma.webhookEndpoint.update({
    where: { id: endpoint.id },
    data: { lastDeliveryAt: new Date(), lastStatus: error ? error.slice(0, 120) : `HTTP ${responseStatus}` },
    select: { id: true },
  });

  return result;
}

function sampleLeadPayload() {
  return {
    id: "lead_test",
    name: "Ayesha Khan",
    email: "ayesha@example.com",
    phone: "+923001234567",
    company: "Example Traders",
    status: "NEW",
    score: 65,
    source: "FORM",
    channel: "WEB_WIDGET",
    intent: "Asked for bulk pricing on 50 kettles.",
    fields: [{ key: "budget", label: "Budget", value: "PKR 200,000" }],
  };
}
