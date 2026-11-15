import DashboardLoading from "@/app/dashboard/loading";
import AIAgentsLoading from "@/app/dashboard/ai-agents/loading";
import AgentDetailLoading from "@/app/dashboard/ai-agents/[id]/loading";
import TicketsLoading from "@/app/dashboard/tickets/loading";
import TicketDetailLoading from "@/app/dashboard/tickets/[id]/loading";
import ContactsLoading from "@/app/dashboard/contacts/loading";
import ContactDetailLoading from "@/app/dashboard/contacts/[id]/loading";
import KnowledgeBaseLoading from "@/app/dashboard/knowledge-base/loading";
import ChatbotsLoading from "@/app/dashboard/chatbots/loading";
import InboxesLoading from "@/app/dashboard/inboxes/loading";
import ChatsLoading from "@/app/dashboard/chats/loading";
import AnalyticsLoading from "@/app/dashboard/analytics/loading";
import LeadsLoading from "@/app/dashboard/leads/loading";
import EscalationsLoading from "@/app/dashboard/escalations/loading";
import LogsLoading from "@/app/dashboard/logs/loading";
import AppointmentsLoading from "@/app/dashboard/appointments/loading";
import CannedResponsesLoading from "@/app/dashboard/canned-responses/loading";
import PromptsLoading from "@/app/dashboard/prompts/loading";
import IntegrationsLoading from "@/app/dashboard/integrations/loading";
import ToolsLoading from "@/app/dashboard/tools/loading";
import ReportsLoading from "@/app/dashboard/reports/loading";
import SettingsLoading from "@/app/dashboard/settings/loading";
import ProfileLoading from "@/app/dashboard/profile/loading";
import UsersLoading from "@/app/dashboard/users/loading";
import TagsLoading from "@/app/dashboard/tags/loading";

export function DashboardRouteSkeleton({ href }: { href: string }) {
  const path = href.split("?")[0].replace(/\/$/, "");

  // Match detail routes first
  if (/^\/dashboard\/ai-agents\/[^/]+$/.test(path)) {
    return <AgentDetailLoading />;
  }
  if (/^\/dashboard\/tickets\/[^/]+$/.test(path)) {
    return <TicketDetailLoading />;
  }
  if (/^\/dashboard\/contacts\/[^/]+$/.test(path)) {
    return <ContactDetailLoading />;
  }

  // Section routes
  if (path.startsWith("/dashboard/ai-agents")) {
    return <AIAgentsLoading />;
  }
  if (path.startsWith("/dashboard/tickets")) {
    return <TicketsLoading />;
  }
  if (path.startsWith("/dashboard/knowledge-base")) {
    return <KnowledgeBaseLoading />;
  }
  if (path.startsWith("/dashboard/chatbots")) {
    return <ChatbotsLoading />;
  }
  if (path.startsWith("/dashboard/inboxes")) {
    return <InboxesLoading />;
  }
  if (path.startsWith("/dashboard/chats")) {
    return <ChatsLoading />;
  }
  if (path.startsWith("/dashboard/analytics")) {
    return <AnalyticsLoading />;
  }
  if (path.startsWith("/dashboard/contacts")) {
    return <ContactsLoading />;
  }
  if (path.startsWith("/dashboard/leads")) {
    return <LeadsLoading />;
  }
  if (path.startsWith("/dashboard/escalations")) {
    return <EscalationsLoading />;
  }
  if (path.startsWith("/dashboard/logs")) {
    return <LogsLoading />;
  }
  if (path.startsWith("/dashboard/appointments")) {
    return <AppointmentsLoading />;
  }
  if (path.startsWith("/dashboard/canned-responses")) {
    return <CannedResponsesLoading />;
  }
  if (path.startsWith("/dashboard/prompts")) {
    return <PromptsLoading />;
  }
  if (path.startsWith("/dashboard/integrations")) {
    return <IntegrationsLoading />;
  }
  if (path.startsWith("/dashboard/tools")) {
    return <ToolsLoading />;
  }
  if (path.startsWith("/dashboard/reports")) {
    return <ReportsLoading />;
  }
  if (path.startsWith("/dashboard/settings")) {
    return <SettingsLoading />;
  }
  if (path.startsWith("/dashboard/profile")) {
    return <ProfileLoading />;
  }
  if (path.startsWith("/dashboard/users")) {
    return <UsersLoading />;
  }
  if (path.startsWith("/dashboard/tags")) {
    return <TagsLoading />;
  }

  return <DashboardLoading />;
}
