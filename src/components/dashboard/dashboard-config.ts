export type DashboardItem = {
  href: string;
  title: string;
  section: string;
  description: string;
  moduleLabel: string;
  group: string;
};

export const dashboardItems: DashboardItem[] = [
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

export const dashboardPageOrder = dashboardItems.map((item) => item.section);
