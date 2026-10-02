import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { notifyTeamOfLead } from "@/src/lib/leads";
import { RATE_LIMITS, consumeRateLimit, tooManyRequests } from "@/src/lib/rate-limit";
import { requireRole } from "@/src/lib/rbac";

/** Sends a sample "new lead" notification to the configured email and Slack targets. */
export async function POST() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const limit = await consumeRateLimit(`lead-notify-test:${session.user.id}`, RATE_LIMITS.aiTestPerUser);

  if (!limit.allowed) {
    return tooManyRequests(limit, "Too many test notifications.");
  }

  const now = new Date().toISOString();
  const results = await notifyTeamOfLead(
    {
      id: "test",
      name: "Ayesha Khan",
      email: "ayesha@example.com",
      phone: "+923001234567",
      company: "Example Traders",
      fields: [{ key: "budget", label: "Budget", value: "PKR 200,000" }],
      intent: "Asked for bulk pricing on 50 kettles.",
      source: "FORM",
      channel: "WEB_WIDGET",
      status: "NEW",
      score: 75,
      temperature: "HOT",
      marketingConsent: true,
      pageHost: null,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      chatbot: null,
      owner: null,
      contact: null,
      session: null,
    },
    session.user.workspaceId,
    { test: true },
  );

  if (results.length === 0) {
    return NextResponse.json(
      { error: "Add a notification email or a Slack webhook URL first." },
      { status: 400 },
    );
  }

  return NextResponse.json({ results });
}
