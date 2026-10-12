import { NextResponse } from "next/server";
import { workspaceTimeZone } from "@/src/lib/analytics";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type TranscriptRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const senderLabels: Record<string, string> = {
  USER: "Customer",
  AI: "AI assistant",
  AGENT: "Team",
  SYSTEM: "System",
};

/**
 * Downloads a conversation transcript (Module 4 FE-2: transcripts for analysis and
 * quality assurance), as plain text or `?format=json`.
 */
export async function GET(request: Request, context: TranscriptRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const chat = await prisma.chatSession.findFirst({
    where: { id, workspaceId: session.user.workspaceId },
    select: {
      id: true,
      channel: true,
      status: true,
      resolution: true,
      closedReason: true,
      startedAt: true,
      endedAt: true,
      customerName: true,
      customerEmail: true,
      summary: true,
      chatbot: { select: { name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: { sender: true, content: true, authorName: true, createdAt: true, feedback: { select: { rating: true, comment: true } } },
      },
    },
  });

  if (!chat) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const format = new URL(request.url).searchParams.get("format");
  const fileBase = `transcript-${chat.id}`;

  if (format === "json") {
    return new Response(JSON.stringify(chat, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileBase}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const timeZone = await workspaceTimeZone(session.user.workspaceId);
  const time = (date: Date) =>
    new Intl.DateTimeFormat("sv-SE", { timeZone, dateStyle: "short", timeStyle: "medium" }).format(date);
  const header = [
    `AssistDesk conversation ${chat.id}`,
    `Channel: ${chat.channel}${chat.chatbot ? ` (${chat.chatbot.name})` : ""}`,
    `Customer: ${chat.customerName ?? chat.customerEmail ?? "Visitor"}`,
    `Started: ${time(chat.startedAt)}${chat.endedAt ? ` · Ended: ${time(chat.endedAt)}` : ""}`,
    `Status: ${chat.status}${chat.resolution ? ` · ${chat.resolution}` : ""}${chat.closedReason ? ` · ${chat.closedReason}` : ""}`,
    chat.summary ? `Summary: ${chat.summary}` : null,
    `Times in ${timeZone}`,
    "",
  ].filter((line) => line !== null);
  const lines = chat.messages.map((message) => {
    const who = message.sender === "AGENT" && message.authorName ? `Team (${message.authorName})` : senderLabels[message.sender] ?? message.sender;
    const rating = message.feedback ? `  [feedback: ${message.feedback.rating > 0 ? "helpful" : "not helpful"}${message.feedback.comment ? ` — ${message.feedback.comment}` : ""}]` : "";
    return `[${time(message.createdAt)}] ${who}: ${message.content}${rating}`;
  });

  return new Response(`${[...header, ...lines].join("\n")}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileBase}.txt"`,
      "Cache-Control": "no-store",
    },
  });
}
