import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { loadContactList } from "@/src/lib/contact-list";

/**
 * Customers known to the workspace (Module 5 Unified Memory Buffer): one Contact
 * joins a person's website, WhatsApp, Slack and email identities. `q` searches
 * name, email and phone; `take` up to 100.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const result = await loadContactList(session.user.workspaceId, {
    query: params.get("q"),
    take: Number(params.get("take")) || 50,
  });

  return NextResponse.json(result);
}
