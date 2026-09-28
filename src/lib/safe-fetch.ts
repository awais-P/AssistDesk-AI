import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {}

type SafeFetchOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

export type SafeFetchResult = {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  body: Buffer;
};

function ipv4ToNumber(address: string) {
  return address
    .split(".")
    .reduce((total, part) => (total << 8) + Number(part), 0) >>> 0;
}

function isPrivateIpv4(address: string) {
  const value = ipv4ToNumber(address);
  const ranges: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];

  return ranges.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToNumber(base) & mask);
  });
}

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");

  if (isIP(normalized) === 4) {
    return isPrivateIpv4(normalized);
  }

  if (isIP(normalized) === 6) {
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);

    if (mapped) {
      return isPrivateIpv4(mapped[1]);
    }

    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff")
    );
  }

  return true;
}

/**
 * Validates that a URL is http(s) and resolves only to public addresses.
 * Blocks localhost, private networks and cloud metadata endpoints (SSRF).
 */
export async function assertPublicUrl(rawUrl: string) {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("Please enter a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https URLs are supported.");
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are not allowed.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new UnsafeUrlError("Local addresses cannot be used as knowledge sources.");
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => {
        throw new UnsafeUrlError(`Could not resolve ${hostname}.`);
      });

  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new UnsafeUrlError(
      "This URL points to a private or internal network address and cannot be fetched.",
    );
  }

  return url;
}

async function readLimitedBody(response: Response, maxBytes: number) {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      await reader.cancel();
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      break;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

/**
 * GET a public URL with SSRF protection, a timeout, redirect re-validation and a body size cap.
 */
export async function safeFetch(
  rawUrl: string,
  {
    headers = {},
    timeoutMs = 12_000,
    maxBytes = 2_000_000,
    maxRedirects = 4,
  }: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  let currentUrl = rawUrl;
  const signal = AbortSignal.timeout(timeoutMs);

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const url = await assertPublicUrl(currentUrl);
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": "AssistDeskBot/1.0 (+https://assistdesk.ai/bot)",
          ...headers,
        },
        redirect: "manual",
        signal,
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error("The URL took too long to respond.");
      }

      throw new Error(`Unable to reach ${url.hostname}.`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");

      if (!location) {
        throw new Error("The URL redirected without a destination.");
      }

      currentUrl = new URL(location, url).toString();
      continue;
    }

    return {
      url: url.toString(),
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type") || "",
      body: await readLimitedBody(response, maxBytes),
    };
  }

  throw new Error("The URL redirected too many times.");
}
