/**
 * Module 4 analytics: pure calculations (no database), shared by the analytics
 * service, the reports and the unit tests.
 */

export const ANALYTICS_CHANNELS = ["WEB_WIDGET", "WHATSAPP", "SLACK", "EMAIL"] as const;
export type AnalyticsChannel = (typeof ANALYTICS_CHANNELS)[number];

export function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

/** Nearest-rank percentile (p in 0–100). */
export function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

export function ratio(part: number, total: number) {
  return total > 0 ? part / total : null;
}

/** Relative change vs the previous period, or null when there is nothing to compare. */
export function delta(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) {
    return null;
  }

  return (current - previous) / previous;
}

/**
 * SRS FR-11.2 automation rate: AI-resolved conversations / all finished conversations.
 * Conversations still open are not counted yet.
 */
export function automationRate(resolutions: Array<string | null>) {
  const finished = resolutions.filter((resolution): resolution is string => Boolean(resolution));
  return ratio(finished.filter((resolution) => resolution === "AI_RESOLVED").length, finished.length);
}

/** Calendar parts of a date in a time zone (for hour buckets and heatmaps). */
export function zonedParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    // Monday = 0 … Sunday = 6
    weekday: Math.max(0, weekdays.indexOf(parts.weekday)),
  };
}

export function safeTimeZone(value: string | null | undefined) {
  try {
    if (value) {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return value;
    }
  } catch {
    // Invalid zone: fall through.
  }

  return "UTC";
}

/** Days between two dates as YYYY-MM-DD keys in the time zone, oldest first. */
export function dateKeysBetween(from: Date, to: Date, timeZone: string) {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (let time = from.getTime(); time <= to.getTime() + 1; time += 60 * 60 * 1000) {
    const key = zonedParts(new Date(time), timeZone).dateKey;

    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }

  return keys;
}

/**
 * FR-11.5: the last 24 hours in hourly buckets (oldest first), labelled HH:00 in the
 * workspace time zone, with the average and 95th-percentile latency of each hour.
 */
export function latencyBuckets(
  samples: Array<{ at: Date; latencyMs: number }>,
  now: Date,
  timeZone: string,
) {
  const hourMs = 60 * 60 * 1000;
  const end = Math.floor(now.getTime() / hourMs) * hourMs + hourMs;
  const buckets = Array.from({ length: 24 }, (_, index) => {
    const start = end - (24 - index) * hourMs;
    return {
      start: new Date(start).toISOString(),
      label: `${String(zonedParts(new Date(start), timeZone).hour).padStart(2, "0")}:00`,
      values: [] as number[],
    };
  });

  for (const sample of samples) {
    const index = Math.floor((sample.at.getTime() - (end - 24 * hourMs)) / hourMs);

    if (index >= 0 && index < 24) {
      buckets[index].values.push(sample.latencyMs);
    }
  }

  return buckets.map((bucket) => ({
    start: bucket.start,
    label: bucket.label,
    count: bucket.values.length,
    avgMs: bucket.values.length ? Math.round(average(bucket.values) as number) : null,
    p95Ms: percentile(bucket.values, 95),
  }));
}

/** 7 × 24 grid (Monday first) of how many customer messages arrived per weekday-hour. */
export function activityHeatmap(dates: Date[], timeZone: string) {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

  for (const date of dates) {
    const { weekday, hour } = zonedParts(date, timeZone);
    grid[weekday][hour] += 1;
  }

  return grid;
}

// ---------- FAQ clustering (FE-4) ----------

const STOP_WORDS = new Set(
  (
    "a an and are as at be by can could do does for from get got have hello hi hey how i if in is it " +
    "me my of on or our please so that the there this to u was we what when where which who why " +
    "will with would you your im its thanks thank ok okay pls plz " +
    // Roman Urdu fillers
    "ka ki ke ko hai hain kya se mein main mujhe ap aap acha jee ji"
  ).split(" "),
);

/** Lower-cased content words of a question, for grouping similar questions. */
export function questionTokens(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(token) && !/^\d+$/.test(token))
    .map(stemToken)
    .filter((token) => (/^[a-z0-9]+$/.test(token) ? token.length > 1 : token.length > 0));
}

/**
 * Very light English stemming so "deliver / delivery / delivered" and
 * "price / prices / pricing" match. Other scripts (Urdu) are left unchanged.
 */
export function stemToken(token: string) {
  if (!/^[a-z]+$/.test(token) || token.length <= 4) {
    return token;
  }

  let stem = token;

  if (stem.endsWith("ies")) {
    stem = `${stem.slice(0, -3)}y`;
  } else if (/(ing|ed)$/.test(stem) && stem.length > 5) {
    stem = stem.replace(/(ing|ed)$/, "");
  } else if (stem.endsWith("es") && stem.length > 5) {
    stem = stem.slice(0, -2);
  } else if (stem.endsWith("s") && !stem.endsWith("ss")) {
    stem = stem.slice(0, -1);
  }

  return stem.length > 4 && /[ey]$/.test(stem) ? stem.slice(0, -1) : stem;
}

export function jaccard(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
    }
  }

  return shared / (left.size + right.size - shared);
}

/**
 * Share of the smaller question's words that appear in the larger one. A short question
 * ("refund policy?") contained in a longer one ("refund policy for damaged kettles")
 * asks the same thing.
 */
export function containment(left: Set<string>, right: Set<string>) {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];

  if (small.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const token of small) {
    if (large.has(token)) {
      shared += 1;
    }
  }

  return shared / small.size;
}

export type QuestionSample = {
  id: string;
  text: string;
  at: Date;
  channel: string;
  grounded: boolean;
  usedFallback: boolean;
};

export type QuestionCluster = {
  label: string;
  count: number;
  answeredRate: number | null;
  fallbackRate: number | null;
  channels: Record<string, number>;
  examples: string[];
  ids: string[];
  lastAskedAt: string;
};

/**
 * Groups similar questions (greedy, most frequent first). Two questions join when
 * their content words overlap enough (Jaccard ≥ threshold), when one question's words
 * (at least two) are all part of the other, or, when semantic
 * vectors are given, when their cosine similarity is high. The label is the most
 * common wording in the group.
 */
export function clusterQuestions(
  samples: QuestionSample[],
  {
    threshold = 0.5,
    vectors,
    cosineThreshold = 0.82,
    limit = 20,
  }: { threshold?: number; vectors?: Map<string, number[]>; cosineThreshold?: number; limit?: number } = {},
) {
  type Group = { tokens: Set<string>; vector?: number[]; members: QuestionSample[] };
  const groups: Group[] = [];

  for (const sample of samples) {
    const tokens = new Set(questionTokens(sample.text));

    if (tokens.size === 0) {
      continue;
    }

    const vector = vectors?.get(sample.id);
    let best: Group | null = null;
    let bestScore = 0;

    for (const group of groups) {
      const lexical = jaccard(tokens, group.tokens);
      const contained = Math.min(tokens.size, group.tokens.size) >= 2 && containment(tokens, group.tokens) === 1;
      const semantic = vector && group.vector ? cosine(vector, group.vector) : 0;
      const matches = lexical >= threshold || contained || (semantic >= cosineThreshold && lexical > 0);
      const score = Math.max(lexical, semantic);

      if (matches && score > bestScore) {
        best = group;
        bestScore = score;
      }
    }

    if (best) {
      best.members.push(sample);
    } else {
      groups.push({ tokens, vector, members: [sample] });
    }
  }

  return groups
    .map((group): QuestionCluster => {
      const wordings = new Map<string, number>();

      for (const member of group.members) {
        const wording = member.text.trim().replace(/\s+/g, " ");
        wordings.set(wording, (wordings.get(wording) ?? 0) + 1);
      }

      const ranked = [...wordings.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
      const channels: Record<string, number> = {};

      for (const member of group.members) {
        channels[member.channel] = (channels[member.channel] ?? 0) + 1;
      }

      return {
        label: truncate(ranked[0][0], 160),
        count: group.members.length,
        answeredRate: ratio(group.members.filter((member) => member.grounded).length, group.members.length),
        fallbackRate: ratio(group.members.filter((member) => member.usedFallback).length, group.members.length),
        channels,
        examples: ranked.slice(0, 3).map(([wording]) => truncate(wording, 200)),
        ids: group.members.map((member) => member.id),
        lastAskedAt: new Date(Math.max(...group.members.map((member) => member.at.getTime()))).toISOString(),
      };
    })
    .sort((a, b) => b.count - a.count || b.lastAskedAt.localeCompare(a.lastAskedAt))
    .slice(0, limit);
}

function cosine(left: number[], right: number[]) {
  let dot = 0;
  let a = 0;
  let b = 0;

  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    dot += left[index] * right[index];
    a += left[index] * left[index];
    b += right[index] * right[index];
  }

  return a && b ? dot / Math.sqrt(a * b) : 0;
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** "AI resolved" / "Escalated" labels of FR-11.6 from a session's state. */
export function interactionStatus(session: { status: string; resolution: string | null }) {
  if (session.status !== "CLOSED") {
    return session.status === "ESCALATED" ? ("WITH_TEAM" as const) : ("ACTIVE" as const);
  }

  if (session.resolution === "AI_RESOLVED") return "AI_RESOLVED" as const;
  if (session.resolution === "HUMAN_HANDLED") return "ESCALATED" as const;
  return "UNANSWERED" as const;
}

/** Anonymised customer label (SRS: "user identifier (anonymized)"): initials + short id. */
export function anonymizeCustomer(name: string | null, id: string) {
  const initials = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

  return `${initials || "Visitor"} · ${id.slice(-4).toUpperCase()}`;
}
