import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectDocumentKind, extractDocumentText } from "@/src/lib/document-extract";
import { extractHtmlLinks, extractHtmlTitle, htmlToText } from "@/src/lib/html-text";
import { clampMaxPages, isSameSite } from "@/src/lib/web-crawler";

describe("document type detection", () => {
  it("recognises supported knowledge files", () => {
    expect(detectDocumentKind("guide.PDF", null)).toBe("pdf");
    expect(detectDocumentKind("faq.docx", null)).toBe("docx");
    expect(detectDocumentKind("page.htm", null)).toBe("html");
    expect(detectDocumentKind("notes.md", null)).toBe("text");
    expect(detectDocumentKind("data", "application/json")).toBe("text");
    expect(detectDocumentKind("virus.exe", "application/octet-stream")).toBeNull();
    expect(detectDocumentKind("old.doc", null)).toBeNull();
  });

  it("extracts text from plain and HTML uploads", async () => {
    await expect(
      extractDocumentText({
        buffer: Buffer.from("Refunds take 5 days.\r\n\r\n\r\nThanks"),
        fileName: "a.txt",
        mimeType: "text/plain",
      }),
    ).resolves.toBe("Refunds take 5 days.\n\nThanks");

    await expect(
      extractDocumentText({
        buffer: Buffer.from(
          "<html><body><nav>Menu</nav><h1>Shipping</h1><p>We ship in 2 days &amp; free.</p><script>x()</script></body></html>",
        ),
        fileName: "a.html",
        mimeType: "text/html",
      }),
    ).resolves.toBe("Shipping\nWe ship in 2 days & free.");

    await expect(
      extractDocumentText({ buffer: Buffer.from("x"), fileName: "a.exe", mimeType: null }),
    ).rejects.toThrow(/not supported/);
  });

  it("extracts text from real PDF and Word files", async () => {
    const fixtures = path.join(__dirname, "..", "fixtures");

    await expect(
      extractDocumentText({
        buffer: await readFile(path.join(fixtures, "exchange.pdf")),
        fileName: "exchange.pdf",
        mimeType: "application/pdf",
      }),
    ).resolves.toContain("sizes can be exchanged within 14 days");

    const docxText = await extractDocumentText({
      buffer: await readFile(path.join(fixtures, "warranty.docx")),
      fileName: "warranty.docx",
      mimeType: null,
    });
    expect(docxText).toContain("Warranty Policy");
    expect(docxText).toContain("6 month warranty");
  });
});

describe("HTML helpers", () => {
  it("extracts title, readable text and links", () => {
    const html = `<html><head><title>Help &#8211; Acme</title></head><body>
      <header>Logo</header><main><h2>Returns</h2><ul><li>30 days</li><li>Free label</li></ul>
      <a href="/pricing#plans">Pricing</a><a href="https://other.com/x">Out</a></main></body></html>`;

    expect(extractHtmlTitle(html)).toBe("Help – Acme");
    expect(htmlToText(html)).toContain("Returns");
    expect(htmlToText(html)).toContain("- 30 days");
    expect(htmlToText(html)).not.toContain("Logo");
    expect(extractHtmlLinks(html, "https://acme.com/help")).toEqual([
      "https://acme.com/pricing",
      "https://other.com/x",
    ]);
  });
});

describe("crawler scope", () => {
  const root = new URL("https://www.acme.com/docs");

  it("stays on the same site and skips binary files", () => {
    expect(isSameSite("https://acme.com/pricing", root)).toBe(true);
    expect(isSameSite("https://blog.acme.com/", root)).toBe(false);
    expect(isSameSite("https://acme.com/brochure.pdf", root)).toBe(false);
    expect(isSameSite("mailto:hi@acme.com", root)).toBe(false);
  });

  it("clamps the page limit", () => {
    expect(clampMaxPages(100, "CRAWL")).toBe(25);
    expect(clampMaxPages(1, "CRAWL")).toBe(2);
    expect(clampMaxPages("abc", "CRAWL")).toBe(10);
    expect(clampMaxPages(20, "SINGLE")).toBe(1);
  });
});
