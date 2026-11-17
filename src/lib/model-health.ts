/**
 * Remembers models that should be skipped for a while, so the fallback chain stops
 * wasting a round trip on them (latency):
 *   - retired: the provider says the model no longer exists (a free OpenRouter model
 *     that was withdrawn), skipped for 6 hours;
 *   - cooling: the model is rate-limited, overloaded or too slow right now (429, 503,
 *     timeouts), skipped for 2 minutes so the next reply goes straight to one that works.
 * In memory per server process; entries expire so a model can come back.
 */

const RETIRED_TTL_MS = 6 * 60 * 60 * 1000;
export const COOLDOWN_MS = 2 * 60 * 1000;
const retired = new Map<string, { until: number; reason: string }>();
const cooling = new Map<string, { until: number; reason: string }>();

/** Errors that mean "this model is gone" rather than "busy right now" (429, timeouts). */
export function isModelGoneError(message: string) {
  return /\b404\b|model[_ ]not[_ ]found|no endpoints found|is (?:not available|unavailable)|unavailable for free|does not exist|decommissioned|deprecated/i.test(message);
}

/** Errors that mean "busy right now": worth skipping for a few minutes, not for hours. */
export function isModelBusyError(message: string) {
  return /\b(429|502|503|529)\b|rate[ -]?limit|too many requests|overloaded|capacity|took too long|timed? ?out|timeout/i.test(message);
}

export function markModelGone(modelId: string, reason: string, now = Date.now()) {
  retired.set(modelId, { until: now + RETIRED_TTL_MS, reason: reason.slice(0, 200) });
}

export function markModelCooling(modelId: string, reason: string, now = Date.now()) {
  cooling.set(modelId, { until: now + COOLDOWN_MS, reason: reason.slice(0, 200) });
}

function isListed(list: Map<string, { until: number }>, modelId: string, now: number) {
  const entry = list.get(modelId);

  if (!entry) {
    return false;
  }

  if (entry.until <= now) {
    list.delete(modelId);
    return false;
  }

  return true;
}

export function isModelGone(modelId: string, now = Date.now()) {
  return isListed(retired, modelId, now);
}

export function isModelCooling(modelId: string, now = Date.now()) {
  return isListed(cooling, modelId, now);
}

/** Notes a failure; returns true when the model was marked as gone or cooling. */
export function recordModelFailure(modelId: string, message: string) {
  if (isModelGoneError(message)) {
    markModelGone(modelId, message);
    console.warn(`[llm] ${modelId} looks retired (${message.slice(0, 120)}); skipping it for 6 hours.`);
    return true;
  }

  if (isModelBusyError(message)) {
    markModelCooling(modelId, message);
    console.warn(`[llm] ${modelId} is busy (${message.slice(0, 120)}); skipping it for ${COOLDOWN_MS / 60_000} minutes.`);
    return true;
  }

  return false;
}

/**
 * Drops retired and cooling models from a chain, but never empties it: if every model is
 * cooling, the cooling ones are tried (busy beats nothing); if all are retired, all are.
 */
export function withoutGoneModels<T>(candidates: T[], idOf: (candidate: T) => string) {
  const now = Date.now();
  const notGone = candidates.filter((candidate) => !isModelGone(idOf(candidate), now));
  const ready = notGone.filter((candidate) => !isModelCooling(idOf(candidate), now));

  if (ready.length) {
    return ready;
  }

  return notGone.length ? notGone : candidates;
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
  cooling.clear();
}
