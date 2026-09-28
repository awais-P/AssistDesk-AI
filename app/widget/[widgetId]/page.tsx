import { headers } from "next/headers";
import { ChatbotWidgetClient } from "@/src/components/widget/chatbot-widget-client";
import { getCurrentSession } from "@/src/lib/auth";
import {
  PREVIEW_HOST,
  getWidgetChatbot,
  isAllowedWidgetHost,
  parseHostFromUrl,
} from "@/src/lib/chatbot-widget";
import { createWidgetToken } from "@/src/lib/widget-token";

type WidgetPageProps = {
  params: Promise<{
    widgetId: string;
  }>;
};

function WidgetBlocked({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

export default async function WidgetPage({ params }: WidgetPageProps) {
  const { widgetId } = await params;
  const chatbot = await getWidgetChatbot(widgetId);

  if (!chatbot) {
    return <WidgetBlocked message="This chat widget does not exist." />;
  }

  const requestHeaders = await headers();
  // The browser sets Referer on the iframe request to the embedding page; pages
  // cannot forge it, which is what makes the allowed-domain check meaningful.
  const referer = requestHeaders.get("referer");
  const embeddingHost = parseHostFromUrl(referer);
  const appAuthority = (
    requestHeaders.get("x-forwarded-host") ||
    requestHeaders.get("host") ||
    ""
  ).toLowerCase();
  let refererAuthority = "";

  try {
    refererAuthority = referer ? new URL(referer).host.toLowerCase() : "";
  } catch {
    refererAuthority = "";
  }

  let tokenHost: string | null = null;

  // Compare host:port so a local test site (e.g. localhost:8080) is not mistaken
  // for the AssistDesk dashboard itself.
  if (embeddingHost && refererAuthority !== appAuthority) {
    tokenHost = isAllowedWidgetHost(embeddingHost, chatbot.allowedDomains)
      ? embeddingHost
      : null;
  } else {
    // Opened directly or from the AssistDesk dashboard: only team members of this
    // workspace may use it (live test / preview mode).
    const session = await getCurrentSession();
    tokenHost = session?.user.workspaceId === chatbot.workspaceId ? PREVIEW_HOST : null;
  }

  if (!tokenHost) {
    return (
      <WidgetBlocked message="This website is not allowed to load this chat widget. Add the domain under Chatbot → Allowed Domains." />
    );
  }

  return (
    <ChatbotWidgetClient
      widgetId={widgetId}
      token={createWidgetToken(widgetId, tokenHost)}
      isPreview={tokenHost === PREVIEW_HOST}
    />
  );
}
