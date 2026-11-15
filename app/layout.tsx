import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://assistdesk.ai";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "AssistDesk — AI Customer Support & Omnichannel Ticketing Platform",
    template: "%s | AssistDesk",
  },
  description:
    "AI-native customer support, agentic automation, real-time context sync, and ticketing platform across web, email, WhatsApp, and Slack.",
  keywords: [
    "AI customer support",
    "customer service agent",
    "omnichannel ticketing",
    "agentic AI tools",
    "helpdesk",
    "conversational AI",
  ],
  authors: [{ name: "AssistDesk Team" }],
  creator: "AssistDesk",
  publisher: "AssistDesk",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "AssistDesk — AI-Native Customer Support Platform",
    description:
      "Enterprise-grade AI support assistants with agentic actions, knowledge base retrieval, and live human takeover.",
    url: siteUrl,
    siteName: "AssistDesk",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AssistDesk — AI-Native Customer Support Platform",
    description:
      "AI customer support, agentic automation, and omnichannel ticketing platform.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
