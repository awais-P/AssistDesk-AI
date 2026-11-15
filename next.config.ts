import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/** Sent with every response (SEC-14). */
const commonHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

/**
 * Every page except the chat widget: no other site may put it in a frame (clickjacking),
 * and forms, plugins and <base> stay on this origin. Scripts are not restricted here
 * because Next.js adds inline scripts without a nonce.
 */
const appHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=()" },
];

/**
 * The widget is meant to be framed by customers' websites. Which sites may show it is
 * checked by the widget itself against the chatbot's Allowed Domains (fail-closed).
 */
const widgetHeaders = [
  { key: "Content-Security-Policy", value: "base-uri 'self'; form-action 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  // A second dev server (e.g. the one the UI tests use) can set NEXT_DIST_DIR to build into its
  // own folder. Two `next dev` servers sharing .next overwrite each other's files and break pages.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  devIndicators: false,
  serverExternalPackages: ["unpdf", "mammoth"],
  async headers() {
    return [
      { source: "/:path*", headers: commonHeaders },
      { source: "/:path((?!widget(?:/|$)).*)", headers: appHeaders },
      { source: "/widget/:path*", headers: widgetHeaders },
    ];
  },
};

export default nextConfig;
