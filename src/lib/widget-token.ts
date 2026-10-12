import { safeEqual, signPayload } from "./secrets";
import { WIDGET_TOKEN_HEADER } from "./widget-constants";

const TOKEN_PURPOSE = "widget-embed-token";
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

export { WIDGET_TOKEN_HEADER };
export const PREVIEW_HOST = "__dashboard_preview__";

type WidgetTokenPayload = {
  w: string;
  h: string;
  e: number;
};

/**
 * Issues a short-lived token proving that the widget iframe was loaded by an allowed
 * website (checked from the browser's Referer when the iframe page was requested).
 */
export function createWidgetToken(widgetId: string, host: string, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const payload: WidgetTokenPayload = {
    w: widgetId,
    h: host,
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return `${encoded}.${signPayload(TOKEN_PURPOSE, encoded)}`;
}

export function verifyWidgetToken(token: string | null | undefined, widgetId: string) {
  if (!token) {
    return null;
  }

  const [encoded, signature] = token.split(".");

  if (!encoded || !signature || !safeEqual(signature, signPayload(TOKEN_PURPOSE, encoded))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as WidgetTokenPayload;

    if (payload.w !== widgetId || payload.e < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return { host: payload.h, isPreview: payload.h === PREVIEW_HOST };
  } catch {
    return null;
  }
}
