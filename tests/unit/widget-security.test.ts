import { describe, expect, it } from "vitest";
import {
  doesHostMatchAllowedDomain,
  isAllowedWidgetHost,
  parseHostFromUrl,
} from "@/src/lib/chatbot-widget";
import { createWidgetId, isValidDomain, normalizeDomain } from "@/src/lib/setup";
import { PREVIEW_HOST, createWidgetToken, verifyWidgetToken } from "@/src/lib/widget-token";

describe("widget embed tokens", () => {
  it("accepts a valid token for the same widget", () => {
    const token = createWidgetToken("support-abc123", "shop.example.com");

    expect(verifyWidgetToken(token, "support-abc123")).toEqual({
      host: "shop.example.com",
      isPreview: false,
    });
  });

  it("rejects tokens for another widget, forged, tampered or expired tokens", () => {
    const token = createWidgetToken("support-abc123", "example.com");
    const [payload, signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ w: "support-abc123", h: "evil.com", e: 9999999999 }),
    ).toString("base64url");

    expect(verifyWidgetToken(token, "other-widget")).toBeNull();
    expect(verifyWidgetToken(`${forgedPayload}.${signature}`, "support-abc123")).toBeNull();
    expect(verifyWidgetToken(`${payload}.bad`, "support-abc123")).toBeNull();
    expect(
      verifyWidgetToken(createWidgetToken("support-abc123", "example.com", -10), "support-abc123"),
    ).toBeNull();
    expect(verifyWidgetToken(null, "support-abc123")).toBeNull();
  });

  it("marks dashboard preview tokens", () => {
    const token = createWidgetToken("w1", PREVIEW_HOST);
    expect(verifyWidgetToken(token, "w1")?.isPreview).toBe(true);
  });
});

describe("allowed domains", () => {
  it("matches exact domains and subdomains only", () => {
    expect(doesHostMatchAllowedDomain("example.com", "example.com")).toBe(true);
    expect(doesHostMatchAllowedDomain("shop.example.com", "example.com")).toBe(true);
    expect(doesHostMatchAllowedDomain("www.example.com", "https://example.com/")).toBe(true);
    expect(doesHostMatchAllowedDomain("evilexample.com", "example.com")).toBe(false);
    expect(doesHostMatchAllowedDomain("example.com.evil.io", "example.com")).toBe(false);
    expect(isAllowedWidgetHost("", ["example.com"])).toBe(false);
  });

  it("parses the embedding host from a Referer", () => {
    expect(parseHostFromUrl("https://www.Shop.Example.com:8443/cart?x=1")).toBe("shop.example.com");
    expect(parseHostFromUrl("not a url")).toBe("");
    expect(parseHostFromUrl(null)).toBe("");
  });

  it("normalises and validates domains entered by admins", () => {
    expect(normalizeDomain(" HTTPS://www.Example.com/pricing?x ")).toBe("example.com");
    expect(normalizeDomain("localhost:3000")).toBe("localhost");
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("shop.example.co.uk")).toBe(true);
    expect(isValidDomain("localhost")).toBe(true);
    expect(isValidDomain("not a domain")).toBe(false);
    expect(isValidDomain("*.example.com")).toBe(false);
  });

  it("creates unique widget ids even for identical names", () => {
    const first = createWidgetId("Support Bot", "cmworkspace123456");
    const second = createWidgetId("Support Bot", "cmworkspace123456");

    expect(first).toMatch(/^support-bot-/);
    expect(first).not.toBe(second);
  });
});
