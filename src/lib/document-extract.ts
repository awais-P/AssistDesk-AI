import { htmlToText } from "./html-text";
import {
  MAX_KNOWLEDGE_FILE_MB,
  knowledgeFileTypesLabel,
} from "./knowledge-file-types";

export const MAX_KNOWLEDGE_FILE_BYTES = MAX_KNOWLEDGE_FILE_MB * 1024 * 1024;

type DocumentKind = "pdf" | "docx" | "doc" | "html" | "text";

const textExtensions = [".txt", ".md", ".markdown", ".csv", ".json", ".xml", ".log"];

export function detectDocumentKind(
  fileName: string | null,
  mimeType: string | null,
): DocumentKind | null {
  const name = (fileName || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return "pdf";
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    return "docx";
  }

  // FR-10.2: legacy Word 97-2003 documents (binary .doc).
  if (mime === "application/msword" || name.endsWith(".doc")) {
    return "doc";
  }

  if (mime.includes("html") || name.endsWith(".html") || name.endsWith(".htm")) {
    return "html";
  }

  if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    textExtensions.some((extension) => name.endsWith(extension))
  ) {
    return "text";
  }

  return null;
}

export function describeUnsupportedFile(fileName: string | null) {
  return `${fileName || "This file"} is not supported. Upload a ${knowledgeFileTypesLabel} file.`;
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extracts plain text from an uploaded knowledge document (PDF, Word .docx/.doc, HTML or text).
 */
export async function extractDocumentText({
  buffer,
  fileName,
  mimeType,
}: {
  buffer: Buffer;
  fileName: string | null;
  mimeType: string | null;
}) {
  const kind = detectDocumentKind(fileName, mimeType);

  if (!kind) {
    throw new Error(describeUnsupportedFile(fileName));
  }

  let text = "";

  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
  } else if (kind === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (kind === "doc") {
    const { default: WordExtractor } = await import("word-extractor");
    const document = await new WordExtractor().extract(buffer);
    text = document.getBody();
  } else if (kind === "html") {
    text = htmlToText(buffer.toString("utf8"));
  } else {
    text = buffer.toString("utf8");
  }

  const normalized = normalizeExtractedText(text);

  if (!normalized) {
    throw new Error(
      kind === "pdf"
        ? "No readable text was found in this PDF. Scanned (image-only) PDFs are not supported yet."
        : "The uploaded file did not contain readable text.",
    );
  }

  return normalized;
}
