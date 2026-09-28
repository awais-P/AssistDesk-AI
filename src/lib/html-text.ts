const namedEntities: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
};

export function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();

    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    return namedEntities[lower] ?? match;
  });
}

export function extractHtmlTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim() : "";
}

/**
 * Converts an HTML document into readable plain text, dropping scripts, styles
 * and page chrome (nav, header, footer, forms) that would pollute the knowledge base.
 */
export function htmlToText(html: string) {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header|form|aside)\b[\s\S]*?<\/\1>/gi, " ");

  const withBreaks = withoutNoise
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre|main)>/gi, "\n");

  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractHtmlLinks(html: string, baseUrl: string) {
  const links = new Set<string>();

  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    if (match[1].startsWith("#")) {
      continue;
    }

    try {
      const url = new URL(decodeHtmlEntities(match[1]), baseUrl);
      url.hash = "";
      links.add(url.toString());
    } catch {
      // Ignore malformed links.
    }
  }

  return Array.from(links);
}
