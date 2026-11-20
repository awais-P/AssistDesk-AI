import { NextResponse } from "next/server";
import { requirePermission } from "@/src/lib/access";
import { getCurrentSession } from "@/src/lib/auth";
import { sendEscalationAlerts } from "@/src/lib/escalation-alerts";
import { RATE_LIMITS, consumeRateLimit, tooManyRequests } from "@/src/lib/rate-limit";

/** Sends a sample "new escalation" alert to the configured email and Slack targets. */
export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requirePermission(session.user, "escalations.settings", request);

  if (forbidden) {
    return forbidden;
  }

  const limit = await consumeRateLimit(`escalation-alert-test:${session.user.id}`, RATE_LIMITS.aiTestPerUser);

  if (!limit.allowed) {
    return tooManyRequests(limit, "Too many test alerts.");
  }

  const results = await sendEscalationAlerts(
    session.user.workspaceId,
    {
      kind: "created",
      escalationId: "test",
      customer: "Ayesha Khan",
      channel: "WHATSAPP",
      priority: "HIGH",
      triggerLabel: "Asked for a person",
      reason: "Wants to speak to someone about a damaged delivery.",
      assignee: null,
      slaMinutes: 15,
    },
    { test: true },
  );

  if (results.length === 0) {
    return NextResponse.json({ error: "Add an alert email or a Slack webhook URL first." }, { status: 400 });
  }

  return NextResponse.json({ results });
}
