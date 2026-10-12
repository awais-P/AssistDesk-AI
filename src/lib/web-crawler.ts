import { extractHtmlLinks, extractHtmlTitle, htmlToText } from "./html-text";
import { assertPublicUrl, safeFetch } from "./safe-fetch";

export type CrawlMode = "SINGLE" | "CRAWL";

export type CrawledPage = {
  url: string;
  title: string;
  text: string;
};

export type CrawlResult = {
  pages: CrawledPage[];
  engine: "firecrawl" | "builtin";
};

export const MAX_CRAWL_PAGES = 25;
const MIN_PAGE_TEXT = 80;
const CRAWL_TIME_BUDGET_MS = 75_000;
const skippedExtensions =
  /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|rar|gz|mp4|mp3|wav|avi|mov|css|js|json|xml|woff2?|ttf|eot|exe|dmg)$/i;

export function clampMaxPages(value: unknown, mode: CrawlMode) {
  if (mode === "SINGLE") {
    return 1;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return 10;
  }

  return Math.min(MAX_CRAWL_PAGES, Math.max(2, Math.round(parsed)));
}

function normalizeHost(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function isSameSite(candidate: string, root: URL) {
  try {
    const url = new URL(candidate);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      normalizeHost(url.hostname) === normalizeHost(root.hostname) &&
      !skippedExtensions.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function canonicalPageKey(value: string) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return `${normalizeHost(url.hostname)}${url.pathname.replace(/\/$/, "") || "/"}`;
}

async function fetchHtmlPage(url: string) {
  const response = await safeFetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml" },
    timeoutMs: 12_000,
    maxBytes: 2_000_000,
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch this URL (${response.status}).`);
  }

  if (response.contentType && !/html|xml|text\/plain/i.test(response.contentType)) {
    throw new Error("This URL does not return a web page.");
  }

  const html = response.body.toString("utf8");

  return {
    finalUrl: response.url,
    html,
  };
}

async function readSitemapUrls(root: URL, limit: number) {
  try {
    const response = await safeFetch(new URL("/sitemap.xml", root).toString(), {
      timeoutMs: 8_000,
      maxBytes: 1_000_000,
    });

    if (!response.ok) {
      return [];
    }

    const xml = response.body.toString("utf8");

    return Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi))
      .map((match) => match[1])
      .filter((url) => isSameSite(url, root))
      .slice(0, limit * 3);
  } catch {
    return [];
  }
}

async function crawlWithBuiltin(startUrl: string, mode: CrawlMode, maxPages: number) {
  const root = await assertPublicUrl(startUrl);
  const startedAt = Date.now();
  const queue: string[] = [root.toString()];
  const seen = new Set<string>([canonicalPageKey(root.toString())]);
  const pages: CrawledPage[] = [];
  let firstError: Error | null = null;

  if (mode === "CRAWL") {
    for (const url of await readSitemapUrls(root, maxPages)) {
      const key = canonicalPageKey(url);

      if (!seen.has(key)) {
        seen.add(key);
        queue.push(url);
      }
    }
  }

  while (queue.length > 0 && pages.length < maxPages) {
    if (Date.now() - startedAt > CRAWL_TIME_BUDGET_MS) {
      break;
    }

    const batch = queue.splice(0, 3);
    const results = await Promise.allSettled(batch.map((url) => fetchHtmlPage(url)));

    for (const result of results) {
      if (result.status === "rejected") {
        firstError ??= result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        continue;
      }

      const { finalUrl, html } = result.value;
      const text = htmlToText(html);

      if (text.length >= MIN_PAGE_TEXT && pages.length < maxPages) {
        pages.push({
          url: finalUrl,
          title: extractHtmlTitle(html) || new URL(finalUrl).pathname,
          text,
        });
      }

      if (mode === "CRAWL") {
        for (const link of extractHtmlLinks(html, finalUrl)) {
          if (!isSameSite(link, root)) {
            continue;
          }

          const key = canonicalPageKey(link);

          if (!seen.has(key) && seen.size < maxPages * 6) {
            seen.add(key);
            queue.push(link);
          }
        }
      }
    }

    if (mode === "SINGLE") {
      break;
    }
  }

  if (pages.length === 0) {
    throw firstError ?? new Error("The page did not return enough readable content.");
  }

  return pages;
}

type FirecrawlDocument = {
  markdown?: string;
  metadata?: {
    title?: string;
    sourceURL?: string;
    url?: string;
  };
};

async function firecrawlRequest<T>(path: string, init: RequestInit & { apiKey: string }) {
  const { apiKey, ...rest } = init;
  const response = await fetch(`https://api.firecrawl.dev/v1${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || `Firecrawl request failed (${response.status}).`);
  }

  return data;
}

function firecrawlDocToPage(doc: FirecrawlDocument, fallbackUrl: string): CrawledPage | null {
  const text = (doc.markdown || "").trim();

  if (text.length < MIN_PAGE_TEXT) {
    return null;
  }

  const url = doc.metadata?.sourceURL || doc.metadata?.url || fallbackUrl;

  return {
    url,
    title: doc.metadata?.title?.trim() || url,
    text,
  };
}

async function crawlWithFirecrawl(
  startUrl: string,
  mode: CrawlMode,
  maxPages: number,
  apiKey: string,
) {
  await assertPublicUrl(startUrl);

  if (mode === "SINGLE") {
    const result = await firecrawlRequest<{ data?: FirecrawlDocument }>("/scrape", {
      apiKey,
      method: "POST",
      body: JSON.stringify({ url: startUrl, formats: ["markdown"], onlyMainContent: true }),
    });
    const page = result.data ? firecrawlDocToPage(result.data, startUrl) : null;

    if (!page) {
      throw new Error("Firecrawl did not return readable content for this page.");
    }

    return [page];
  }

  const job = await firecrawlRequest<{ id?: string }>("/crawl", {
    apiKey,
    method: "POST",
    body: JSON.stringify({
      url: startUrl,
      limit: maxPages,
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
    }),
  });

  if (!job.id) {
    throw new Error("Firecrawl did not start the crawl job.");
  }

  const deadline = Date.now() + CRAWL_TIME_BUDGET_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const status = await firecrawlRequest<{
      status?: string;
      data?: FirecrawlDocument[];
    }>(`/crawl/${job.id}`, { apiKey, method: "GET" });

    if (status.status === "completed") {
      const pages = (status.data || [])
        .map((doc) => firecrawlDocToPage(doc, startUrl))
        .filter((page): page is CrawledPage => Boolean(page))
        .slice(0, maxPages);

      if (pages.length === 0) {
        throw new Error("Firecrawl finished but found no readable pages.");
      }

      return pages;
    }

    if (status.status === "failed" || status.status === "cancelled") {
      throw new Error(`Firecrawl crawl ${status.status}.`);
    }
  }

  throw new Error("Firecrawl crawl took too long. Try fewer pages.");
}

/**
 * Fetches one page or crawls a website. Uses Firecrawl (SRS CON-6) when
 * FIRECRAWL_API_KEY is configured and falls back to the built-in crawler otherwise.
 */
export async function crawlWebsite({
  url,
  mode,
  maxPages,
}: {
  url: string;
  mode: CrawlMode;
  maxPages: number;
}): Promise<CrawlResult> {
  const pageLimit = clampMaxPages(maxPages, mode);
  const firecrawlKey = process.env.FIRECRAWL_API_KEY?.trim();

  if (firecrawlKey) {
    try {
      return {
        pages: await crawlWithFirecrawl(url, mode, pageLimit, firecrawlKey),
        engine: "firecrawl",
      };
    } catch (error) {
      console.error("[crawler] Firecrawl failed, falling back to built-in crawler:", error);
    }
  }

  return {
    pages: await crawlWithBuiltin(url, mode, pageLimit),
    engine: "builtin",
  };
}

export function combineCrawledPages(pages: CrawledPage[], maxLength: number) {
  const combined = pages
    .map((page) => `# ${page.title}\nSource: ${page.url}\n\n${page.text}`)
    .join("\n\n---\n\n");

  return combined.slice(0, maxLength);
}
