import { describe, it, expect } from "vitest";
import robots from "../../app/robots";
import sitemap from "../../app/sitemap";
import fs from "fs";
import path from "path";

describe("NFR: SEO and Loading Speed Verification", () => {
  it("SEO-02: robots.txt exposes valid crawling rules protecting internal routes", () => {
    const robotsConfig = robots();
    expect(robotsConfig).toBeDefined();
    expect(robotsConfig.rules).toBeDefined();

    const rules = Array.isArray(robotsConfig.rules) ? robotsConfig.rules[0] : robotsConfig.rules;
    expect(rules.userAgent).toBe("*");

    // Public pages should be allowed
    const allowed = Array.isArray(rules.allow) ? rules.allow : [rules.allow];
    expect(allowed).toContain("/");
    expect(allowed).toContain("/login");
    expect(allowed).toContain("/signup");

    // Sensitive / authenticated routes must be disallowed
    const disallowed = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow];
    expect(disallowed).toContain("/dashboard/");
    expect(disallowed).toContain("/api/");

    // Must declare sitemap URL
    expect(robotsConfig.sitemap).toMatch(/sitemap\.xml$/);
  });

  it("SEO-03: sitemap.xml generates valid index of public discovery URLs", () => {
    const sitemapEntries = sitemap();
    expect(Array.isArray(sitemapEntries)).toBe(true);
    expect(sitemapEntries.length).toBeGreaterThan(0);

    const urls = sitemapEntries.map((entry) => entry.url);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://assistdesk.ai";

    expect(urls).toContain(baseUrl);
    expect(urls).toContain(`${baseUrl}/login`);
    expect(urls).toContain(`${baseUrl}/signup`);

    // Verify priorities and change frequencies
    const homeEntry = sitemapEntries.find((entry) => entry.url === baseUrl);
    expect(homeEntry?.priority).toBe(1.0);
    expect(homeEntry?.changeFrequency).toBe("daily");
  });

  it("LOD-02: embeddable widget loader script complies with lightweight bundle budget (<= 25 KB)", () => {
    const widgetScriptPath = path.resolve(process.cwd(), "public", "assistdesk-widget.js");
    expect(fs.existsSync(widgetScriptPath)).toBe(true);

    const stat = fs.statSync(widgetScriptPath);
    const sizeInKb = stat.size / 1024;

    // Must be well under the 25 KB budget
    expect(sizeInKb).toBeLessThan(25);
  });
});
