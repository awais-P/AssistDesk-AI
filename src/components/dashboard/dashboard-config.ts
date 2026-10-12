export type DashboardItem = {
  href: string;
  title: string;
  section: string;
  description: string;
  moduleLabel: string;
  group: string;
  /** Only highlight this item on an exact path match (nested routes don't count). */
  exact?: boolean;
};

export const dashboardItems: DashboardItem[] = [
  {
    href: "/dashboard",
    title: "Overview",
    section: "overview",
    description:
      "See assistant performance, open work, knowledge health, and recent alerts at a glance.",
    moduleLabel: "Module 7 - User Dashboard",
    group: "Main",
    exact: true,
  },
  {
    href: "/dashboard/tickets",
    title: "Tickets",
    section: "tickets",
    description:
      "Manage support tickets, filters, assignments, priorities, and ticket workflows.",
    moduleLabel: "Module 7 - User Dashboard",
    group: "Main",
  },
  {
    href: "/dashboard/chats",
    title: "Chats",
    section: "chats",
    description:
      "View live chat conversations and future human handoff activity in one workspace.",
    moduleLabel: "Module 7 / Module 5",
    group: "Main",
  },
  {
    href: "/dashboard/contacts",
    title: "Contacts",
    section: "contacts",
    description:
      "See every customer across Website, WhatsApp, Slack and Email, with their conversations and AI memory.",
    moduleLabel: "Module 5 - Session & Context Management",
    group: "Main",
  },
  {
    href: "/dashboard/leads",
    title: "Leads",
    section: "leads",
    description:
      "Follow up on everyone who asked to be contacted or showed buying intent, on any channel.",
    moduleLabel: "Module 8 - Lead Generation System",
    group: "Main",
  },
  {
    href: "/dashboard/appointments",
    title: "Appointments",
    section: "appointments",
    description:
      "Appointments booked by the AI in chat or by your team, with business hours for booking.",
    moduleLabel: "Module 2 - Agentic Tools",
    group: "Main",
  },
  {
    href: "/dashboard/analytics",
    title: "Analytics",
    section: "analytics",
    description:
      "Response time, automation rate, leads, live sessions, latency and recent interactions across every channel.",
    moduleLabel: "Module 4 - Monitoring & Analytics",
    group: "Main",
  },
  {
    href: "/dashboard/reports",
    title: "Reports",
    section: "reports",
    description:
      "Review analytics, response trends, automation numbers, and operational insights.",
    moduleLabel: "Module 4 - Monitoring & Analytics",
    group: "Main",
  },
  {
    href: "/dashboard/users",
    title: "Users",
    section: "users",
    description:
      "Manage tenant users, team members, and future role-based access assignments.",
    moduleLabel: "Module 11 - Integrations & System Customization",
    group: "Main",
  },
  {
    href: "/dashboard/ai-agents",
    title: "AI Agents",
    section: "ai-agents",
    description:
      "Create, edit, and configure assistant identity, tone, and future model behavior.",
    moduleLabel: "Module 1 - Assistant Creation & Omnichannel Integration",
    group: "AI",
  },
  {
    href: "/dashboard/tools",
    title: "Tools",
    section: "tools",
    description:
      "Actions your AI agents can take: built-in actions and connections to your own systems.",
    moduleLabel: "Module 2 - Agentic Tools",
    group: "AI",
  },
  {
    href: "/dashboard/prompts",
    title: "Prompts",
    section: "prompts",
    description:
      "Manage reusable prompt templates that shape how your AI agents respond.",
    moduleLabel: "Module 2 - Prompt Management",
    group: "AI",
  },
  {
    href: "/dashboard/logs",
    title: "Logs",
    section: "logs",
    description:
      "Track activity history, assistant actions, system events, and future audit records.",
    moduleLabel: "Module 11 - Integrations & System Customization",
    group: "AI",
  },
  {
    href: "/dashboard/inboxes",
    title: "Inboxes",
    section: "inboxes",
    description:
      "Configure inboxes, prefixes, and shared support destinations for team workflows.",
    moduleLabel: "Module 7 - User Dashboard",
    group: "Setup",
  },
  {
    href: "/dashboard/chatbots",
    title: "Chatbots",
    section: "chatbots",
    description:
      "Set up widget-level chatbot appearance, messages, and web deployment behavior.",
    moduleLabel: "Module 1 - Assistant Creation & Omnichannel Integration",
    group: "Setup",
  },
  {
    href: "/dashboard/knowledge-base",
    title: "Knowledge Base",
    section: "knowledge-base",
    description:
      "Organize training data, manual notes, and website content for assistant knowledge.",
    moduleLabel: "Module 10 - Knowledge Base Management",
    group: "Setup",
  },
  {
    href: "/dashboard/canned-responses",
    title: "Canned Responses",
    section: "canned-responses",
    description:
      "Prepare reusable support replies and standard response snippets for quick handling.",
    moduleLabel: "Module 7 - User Dashboard",
    group: "Setup",
  },
  {
    href: "/dashboard/tags",
    title: "Tags",
    section: "tags",
    description:
      "Organize tickets and workflows using reusable tag labels and classification groups.",
    moduleLabel: "Module 7 - User Dashboard",
    group: "Setup",
  },
  {
    href: "/dashboard/api-keys",
    title: "API Keys",
    section: "api-keys",
    description:
      "Store future integration tokens and external connection keys for platform features.",
    moduleLabel: "Module 11 - Integrations & System Customization",
    group: "Settings",
  },
  {
    href: "/dashboard/settings",
    title: "Settings",
    section: "settings",
    description:
      "Manage workspace-level preferences, branding choices, and general configuration.",
    moduleLabel: "Module 7 - User Dashboard",
    group: "Settings",
  },
  {
    href: "/dashboard/integrations",
    title: "Integrations",
    section: "integrations",
    description:
      "Connect channels like email, WhatsApp, Slack, and future external support entry points.",
    moduleLabel: "Module 1 / Module 11",
    group: "Settings",
  },
  {
    href: "/dashboard/profile",
    title: "Profile",
    section: "profile",
    description:
      "View user identity details, account information, and personal workspace access.",
    moduleLabel: "Profile Area",
    group: "Settings",
  },
];

export const dashboardPageMap = Object.fromEntries(
  dashboardItems.map((item) => [item.section, item]),
) as Record<string, DashboardItem>;

// Sections served by the catch-all /dashboard/[section] route (Overview is /dashboard itself).
export const dashboardPageOrder = dashboardItems
  .filter((item) => item.href.startsWith("/dashboard/"))
  .map((item) => item.section);

export function isDashboardItemActive(item: DashboardItem, pathname: string) {
  if (item.exact) {
    return pathname === item.href;
  }

  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
