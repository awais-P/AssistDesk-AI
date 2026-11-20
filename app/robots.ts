import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://assistdesk.ai";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/signup", "/verify-email", "/forgot-password", "/reset-password"],
        disallow: ["/dashboard/", "/api/", "/setup/", "/widget/preview/", "/invoice/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
