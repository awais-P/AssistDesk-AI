import { sendTeamEmail } from "./mailer";
import { isWorkspaceOnline } from "./presence";
import { prisma } from "./prisma";

/** Most people one alert goes to, so a large team doesn't turn one chat into a mail storm. */
const MAX_RECIPIENTS = 25;

type ChatAlertChatbot = {
  id: string;
  name: string;
  workspaceId: string;
  emailNotifications: boolean;
};

/**
 * SRS FR-13.8, the chatbot's "Email notifications" switch: when a customer starts a new
 * chat and no team member is online, the active team members get an email so someone can
 * pick it up. Sent through the platform SMTP account; returns what happened instead of
 * throwing, because the chat itself must never fail on an alert.
 */
export async function notifyNewChatWhileOffline(
  chatbot: ChatAlertChatbot,
  chat: { customerName?: string | null; customerEmail?: string | null; firstMessage: string },
  send: typeof sendTeamEmail = sendTeamEmail,
) {
  if (!chatbot.emailNotifications) {
    return { sent: false, reason: "switched off" as const };
  }

  if (await isWorkspaceOnline(chatbot.workspaceId)) {
    return { sent: false, reason: "team online" as const };
  }

  const members = await prisma.user.findMany({
    where: { workspaceId: chatbot.workspaceId, isActive: true },
    select: { email: true },
    orderBy: { createdAt: "asc" },
    take: MAX_RECIPIENTS,
  });
  const to = members.map((member) => member.email).filter((email): email is string => Boolean(email));

  if (to.length === 0) {
    return { sent: false, reason: "no recipients" as const };
  }

  const who = chat.customerName || chat.customerEmail || "A website visitor";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
  const result = await send({
    to,
    subject: `New chat on ${chatbot.name} while no one is online`,
    text: [
      `${who} started a chat on "${chatbot.name}" and no one on your team is online.`,
      "",
      `First message: ${chat.firstMessage.slice(0, 500)}`,
      "",
      `Open the conversation: ${appUrl}/dashboard/chats`,
      "",
      "You get this email because Email notifications is on for this chatbot (Chatbots → Notifications).",
    ].join("\n"),
  });

  if (result.status !== "SENT") {
    console.warn(`[chat-alerts] new-chat email not sent: ${result.error ?? result.status}`);
  }

  return { sent: result.status === "SENT", reason: result.status, recipients: to.length };
}
