import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectDocumentKind, extractDocumentText } from "@/src/lib/document-extract";
import { knowledgeFileAcceptAttribute, knowledgeFileTypesLabel } from "@/src/lib/knowledge-file-types";

// A real Word 97-2003 file, saved by Microsoft Word (tests/fixtures/returns-policy.doc).
const DOC = readFileSync(path.join(process.cwd(), "tests", "fixtures", "returns-policy.doc"));

describe("UT-70 legacy Word .doc files in the knowledge base (FR-10.2)", () => {
  it("UT-70.01 .doc files are recognised by name or type, and offered in the upload", () => {
    expect(detectDocumentKind("Returns.DOC", null)).toBe("doc");
    expect(detectDocumentKind("upload", "application/msword")).toBe("doc");
    expect(detectDocumentKind("policy.docx", null)).toBe("docx"); // .docx is still read by mammoth
    expect(knowledgeFileAcceptAttribute.split(",")).toContain(".doc");
    expect(knowledgeFileTypesLabel).toContain(".doc");
  });

  it("UT-70.02 the text of a .doc made by Word is read for indexing", async () => {
    const text = await extractDocumentText({ buffer: DOC, fileName: "returns-policy.doc", mimeType: "application/msword" });

    expect(text).toContain("Northwind returns policy");
    expect(text).toContain("Unused items can be returned within 30 days of delivery for a full refund.");
    expect(text).toContain("Refunds reach the original card within 7 working days.");
  });
});
