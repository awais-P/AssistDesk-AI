/** Shared by the upload UI and the server-side extractor. */
export const MAX_KNOWLEDGE_FILE_MB = 10;

export const knowledgeFileExtensions = [
  ".pdf",
  ".docx",
  ".html",
  ".htm",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".xml",
  ".log",
];

export const knowledgeFileAcceptAttribute = knowledgeFileExtensions.join(",");

export const knowledgeFileTypesLabel = "PDF, Word (.docx), HTML, TXT, Markdown, CSV or JSON";

export const MAX_CRAWL_PAGES_UI = 25;
