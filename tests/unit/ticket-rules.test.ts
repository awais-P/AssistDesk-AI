import { describe, expect, it } from "vitest";
import { publicErrorMessage } from "@/src/lib/api-errors";
import { describeBlockMatch, matchBlockList, parseBlockList, parseInactivityHours } from "@/src/lib/ticket-rules";

describe("UT-61 ticket automation rules - Module 1 FE-1, BUG-03", () => {
  const rules = parseBlockList("spam@bad.com, @junk.io\nnewsletter.example.org; win a prize\n unsubscribe ");

  it("UT-61.01 sorts rules into addresses, domains and keywords", () => {
    expect(rules).toEqual({
      emails: ["spam@bad.com"],
      domains: ["junk.io", "newsletter.example.org"],
      keywords: ["win a prize", "unsubscribe"],
    });
    expect(parseBlockList("")).toEqual({ emails: [], domains: [], keywords: [] });
  });

  it("UT-61.02 blocks an exact address but not others on the same domain", () => {
    expect(matchBlockList(rules, { email: "Spam@Bad.com" })).toEqual({ kind: "email", rule: "spam@bad.com" });
    expect(matchBlockList(rules, { email: "ceo@bad.com" })).toBeNull();
  });

  it("UT-61.03 blocks a whole domain and its subdomains, not look-alikes", () => {
    expect(matchBlockList(rules, { email: "a@junk.io" })?.kind).toBe("domain");
    expect(matchBlockList(rules, { email: "a@mail.junk.io" })?.kind).toBe("domain");
    expect(matchBlockList(rules, { email: "a@notjunk.io" })).toBeNull();
  });

  it("UT-61.04 matches keywords as whole words in the subject or message", () => {
    expect(matchBlockList(rules, { email: "x@ok.com", subject: "Please UNSUBSCRIBE me" })?.rule).toBe("unsubscribe");
    expect(matchBlockList(rules, { email: "x@ok.com", body: "You could   win a\nprize today" })?.rule).toBe("win a prize");
    expect(matchBlockList(parseBlockList("win"), { email: "x@ok.com", body: "The window is broken" })).toBeNull();
  });

  it("UT-61.05 explains why a ticket was blocked", () => {
    expect(describeBlockMatch({ kind: "domain", rule: "junk.io" })).toContain("junk.io");
    expect(describeBlockMatch({ kind: "keyword", rule: "unsubscribe" })).toContain('"unsubscribe"');
  });

  it("UT-61.06 reads inactivity delays in hours, days and weeks", () => {
    expect(parseInactivityHours("After 24h of inactivity", 1)).toBe(24);
    expect(parseInactivityHours("36 hours", 1)).toBe(36);
    expect(parseInactivityHours("after 2 days", 1)).toBe(48);
    expect(parseInactivityHours("1 week", 1)).toBe(168);
    expect(parseInactivityHours("", 48)).toBe(48);
  });

  it("UT-61.07 keeps delays between 1 hour and 90 days", () => {
    expect(parseInactivityHours("5 minutes", 24)).toBe(1);
    expect(parseInactivityHours("0h", 24)).toBe(24);
    expect(parseInactivityHours("500 days", 24)).toBe(90 * 24);
  });
});

describe("UT-62 error messages shown to users - SEC-16", () => {
  it("UT-62.01 passes validation messages through", () => {
    expect(publicErrorMessage(new Error("Files must be 10 MB or smaller."), "fallback")).toBe("Files must be 10 MB or smaller.");
  });

  it("UT-62.02 hides database and file-system errors", () => {
    const original = console.error;
    console.error = () => {};
    try {
      const prismaError = Object.assign(new Error("Unique constraint failed on the fields: (`workspaceId`,`name`)"), { code: "P2002" });
      expect(publicErrorMessage(prismaError, "Unable to save.", "test")).toBe("Unable to save.");
      const fsError = Object.assign(new Error("ENOENT: no such file, open 'D:\\storage\\x'"), { code: "ENOENT", syscall: "open" });
      expect(publicErrorMessage(fsError, "Unable to save.")).toBe("Unable to save.");
      expect(publicErrorMessage(new Error("Invalid `prisma.knowledgeSource.create()` invocation:\n…"), "Unable to save.")).toBe("Unable to save.");
      expect(publicErrorMessage("not an error", "Unable to save.")).toBe("Unable to save.");
    } finally {
      console.error = original;
    }
  });
});
