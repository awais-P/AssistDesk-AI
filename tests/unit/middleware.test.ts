import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";
import { config, middleware } from "@/middleware";

function request(method: string, headers: Record<string, string>) {
  return new NextRequest("http://localhost:3000/api/tickets", { method, headers: { host: "localhost:3000", ...headers } });
}

const signedIn = { cookie: "assistdesk_session=abc" };

describe("UT-63 cross-site requests and security headers - SEC-14", () => {
  it("UT-63.01 refuses a signed-in POST that comes from another site", async () => {
    const response = middleware(request("POST", { ...signedIn, origin: "https://evil.example.com" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Cross-site request refused." });
  });

  it("UT-63.02 lets same-site requests, reads and requests without the session cookie through", () => {
    const passes = (response: Response) => response.headers.get("x-middleware-next") === "1";
    expect(passes(middleware(request("POST", { ...signedIn, origin: "http://localhost:3000" })))).toBe(true);
    expect(passes(middleware(request("GET", { ...signedIn, origin: "https://evil.example.com" })))).toBe(true);
    // Widget, public API keys and provider webhooks don't use the dashboard cookie.
    expect(passes(middleware(request("POST", { origin: "https://customer-site.example.com" })))).toBe(true);
    // Server-to-server calls send no Origin.
    expect(passes(middleware(request("DELETE", signedIn)))).toBe(true);
    expect(config.matcher).toBe("/api/:path*");
  });

  it("UT-63.03 forbids framing the dashboard but lets customer sites frame the widget", async () => {
    const rules = await nextConfig.headers!();
    const appRule = rules.find((rule) => rule.headers.some((header) => header.key === "X-Frame-Options"))!;
    expect(appRule.headers.find((header) => header.key === "Content-Security-Policy")!.value).toContain("frame-ancestors 'none'");
    const pattern = new RegExp(`^${appRule.source.replace("/:path(", "/(")}$`);
    expect(pattern.test("/dashboard/tickets")).toBe(true);
    expect(pattern.test("/widget/abc123")).toBe(false);
    const widgetRule = rules.find((rule) => rule.source === "/widget/:path*")!;
    expect(widgetRule.headers.some((header) => header.key === "X-Frame-Options" || header.value.includes("frame-ancestors"))).toBe(false);
  });
});
