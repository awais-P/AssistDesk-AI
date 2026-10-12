import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { extractHtmlTitle, htmlToText } from "@/src/lib/html-text";
import { UnsafeUrlError, safeFetch } from "@/src/lib/safe-fetch";

/**
 * Checks that a URL can be crawled before it is added as a knowledge source:
 * reachable, public, returns HTML with readable text.
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  const url = typeof body.url === "string" ? body.url.trim() : "";

  if (!url) {
    return NextResponse.json({ error: "Enter a URL to test." }, { status: 400 });
  }

  try {
    const response = await safeFetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml" },
      timeoutMs: 10_000,
      maxBytes: 1_500_000,
    });

    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        message: `The site answered with HTTP ${response.status}. Check the address or make sure the page is public.`,
      });
    }

    if (response.contentType && !/html|xml|text\/plain/i.test(response.contentType)) {
      return NextResponse.json({
        ok: false,
        message: `This URL returns ${response.contentType.split(";")[0]}, not a web page. Upload the file instead.`,
      });
    }

    const html = response.body.toString("utf8");
    const text = htmlToText(html);

    return NextResponse.json({
      ok: text.length >= 120,
      title: extractHtmlTitle(html) || null,
      characters: text.length,
      preview: text.slice(0, 280),
      message:
        text.length >= 120
          ? `Reachable. Found about ${text.length.toLocaleString()} characters of readable text.`
          : "The page loaded but has almost no readable text (it may need JavaScript). Try another page or upload a document.",
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      message:
        error instanceof UnsafeUrlError || error instanceof Error
          ? error.message
          : "The URL could not be reached.",
    });
  }
}
