/**
 * Remembers managed models that the provider says no longer exist (for example a free
 * OpenRouter model that was retired), so the fallback chain stops wasting a round trip
 * on them. In memory per server process; entries expire so a model can come back.
 */

const RETIRED_TTL_MS = 6 * 60 * 60 * 1000;
const retired = new Map<string, { until: number; reason: string }>();

/** Errors that mean "this model is gone" rather than "busy right now" (429, timeouts). */
export function isModelGoneError(message: string) {
  return /\b404\b|model[_ ]not[_ ]found|no endpoints found|is (?:not available|unavailable)|unavailable for free|does not exist|decommissioned|deprecated/i.test(message);
}

export function markModelGone(modelId: string, reason: string, now = Date.now()) {
  retired.set(modelId, { until: now + RETIRED_TTL_MS, reason: reason.slice(0, 200) });
}

export function isModelGone(modelId: string, now = Date.now()) {
  const entry = retired.get(modelId);

  if (!entry) {
    return false;
  }

  if (entry.until <= now) {
    retired.delete(modelId);
    return false;
  }

  return true;
}

/** Notes a failure; returns true when the model was marked as gone. */
export function recordModelFailure(modelId: string, message: string) {
  if (!isModelGoneError(message)) {
    return false;
  }

  markModelGone(modelId, message);
  console.warn(`[llm] ${modelId} looks retired (${message.slice(0, 120)}); skipping it for 6 hours.`);
  return true;
}

/** Drops retired models from a chain, but never empties it. */
export function withoutGoneModels<T>(candidates: T[], idOf: (candidate: T) => string) {
  const healthy = candidates.filter((candidate) => !isModelGone(idOf(candidate)));
  return healthy.length ? healthy : candidates;
}

/** Strips provider/library boilerplate from model error messages shown to admins. */
export function cleanModelError(message: string) {
  return message
    .replace(/\s*Troubleshooting URL:\s*\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function resetModelHealthForTests() {
  retired.clear();
}
