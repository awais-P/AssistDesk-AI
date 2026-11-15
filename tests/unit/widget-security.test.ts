import { describe, expect, it } from "vitest";
import {
  doesHostMatchAllowedDomain,
  isAllowedWidgetHost,
  parseHostFromUrl,
} from "@/src/lib/chatbot-widget";
import { createWidgetId, isValidDomain, normalizeDomain } from "@/src/lib/setup";
import { PREVIEW_HOST, createWidgetToken, verifyWidgetToken } from "@/src/lib/widget-token";

describe("UT-05 widget embed tokens", () => {
  it("UT-05.01 accepts a valid token for the same widget", () => {
    const token = createWidgetToken("support-abc123", "shop.example.com");

    expect(verifyWidgetToken(token, "support-abc123")).toEqual({
      host: "shop.example.com",
      isPreview: false,
    });
  });

  it("UT-05.02 rejects tokens for another widget, forged, tampered or expired tokens", () => {
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

  it("UT-05.03 marks dashboard preview tokens", () => {
    const token = createWidgetToken("w1", PREVIEW_HOST);
    expect(verifyWidgetToken(token, "w1")?.isPreview).toBe(true);
  });
});

describe("UT-06 allowed domains", () => {
  it("UT-06.01 matches the exact allowed domain", () => {
    expect(doesHostMatchAllowedDomain("example.com", "example.com")).toBe(true);
  });

  it("UT-06.02 matches a subdomain of an allowed domain", () => {
    expect(doesHostMatchAllowedDomain("shop.example.com", "example.com")).toBe(true);
  });

  it("UT-06.03 matches the www host of an allowed domain entered as a URL", () => {
    expect(doesHostMatchAllowedDomain("www.example.com", "https://example.com/")).toBe(true);
  });

  it("UT-06.04 rejects a look-alike domain", () => {
    expect(doesHostMatchAllowedDomain("evilexample.com", "example.com")).toBe(false);
  });

  it("UT-06.05 rejects an allowed domain used as a prefix of another domain", () => {
    expect(doesHostMatchAllowedDomain("example.com.evil.io", "example.com")).toBe(false);
  });

  it("UT-06.06 rejects an empty embedding host", () => {
    expect(isAllowedWidgetHost("", ["example.com"])).toBe(false);
  });

  it("UT-06.07 parses the embedding host from a Referer", () => {
    expect(parseHostFromUrl("https://www.Shop.Example.com:8443/cart?x=1")).toBe("shop.example.com");
    expect(parseHostFromUrl("not a url")).toBe("");
    expect(parseHostFromUrl(null)).toBe("");
  });

  it("UT-06.08 normalises a domain entered as a full URL", () => {
    expect(normalizeDomain(" HTTPS://www.Example.com/pricing?x ")).toBe("example.com");
  });

  it("UT-06.09 normalises a domain entered with a port", () => {
    expect(normalizeDomain("localhost:3000")).toBe("localhost");
  });

  it("UT-06.10 accepts valid domains entered by admins", () => {
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("shop.example.co.uk")).toBe(true);
    expect(isValidDomain("localhost")).toBe(true);
  });

  it("UT-06.11 rejects text that is not a domain", () => {
    expect(isValidDomain("not a domain")).toBe(false);
  });

  it("UT-06.12 rejects a wildcard domain", () => {
    expect(isValidDomain("*.example.com")).toBe(false);
  });

  it("UT-06.13 creates unique widget ids even for identical names", () => {
    const first = createWidgetId("Support Bot", "cmworkspace123456");
    const second = createWidgetId("Support Bot", "cmworkspace123456");

    expect(first).toMatch(/^support-bot-/);
    expect(first).not.toBe(second);
  });
});
