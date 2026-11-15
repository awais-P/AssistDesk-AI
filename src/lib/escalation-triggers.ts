/**
 * Module 9 Support Escalation, FE-1 and FE-3: decides, for each customer message, whether
 * the conversation must go to a human. Deterministic and fast (no AI call), so it runs on
 * every message before the AI replies, in English, Roman Urdu and Urdu.
 *
 *  - Sentiment: a weighted word list with negation ("not happy", "acha nahi"),
 *    intensifiers ("very", "bohat") and shouting (CAPS, "!!"), scored from -1 to 1.
 *    A single very negative message or sustained frustration over the last few
 *    messages crosses the workspace's threshold.
 *  - Requests for a person ("can I talk to a human", "kisi insaan se baat karwao").
 *  - Sensitive topics (legal action, chargebacks, fraud, safety) and the workspace's
 *    own trigger phrases.
 */

export type EscalationTrigger =
  | "SENTIMENT"
  | "HUMAN_REQUEST"
  | "KEYWORD"
  | "CUSTOMER_FLAGGED"
  | "AI_TOOL"
  | "TOOL_FAILURE"
  | "MANUAL";

export type EscalationPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type EscalationSettings = {
  enabled: boolean;
  sentimentEnabled: boolean;
  sentimentThreshold: number;
  onHumanRequest: boolean;
  sensitiveTopics: boolean;
  keywords: string[];
  slaMinutes: number;
};

export const DEFAULT_ESCALATION_SETTINGS: EscalationSettings = {
  enabled: true,
  sentimentEnabled: true,
  sentimentThreshold: -0.5,
  onHumanRequest: true,
  sensitiveTopics: true,
  keywords: [],
  slaMinutes: 15,
};

export const TRIGGER_LABELS: Record<EscalationTrigger, string> = {
  SENTIMENT: "Negative sentiment",
  HUMAN_REQUEST: "Asked for a person",
  KEYWORD: "Sensitive topic",
  CUSTOMER_FLAGGED: "Customer kept with the team",
  AI_TOOL: "AI handed over",
  TOOL_FAILURE: "Action failed",
  MANUAL: "Taken over by the team",
};

// ------------------------------------------------------------------ sentiment

/** Word weights from -3 (very negative) to 3 (very positive). */
const LEXICON: Record<string, number> = {
  // English, negative
  terrible: -3, horrible: -3, awful: -3, worst: -3, useless: -3, pathetic: -3, disgusting: -3,
  ridiculous: -3, unacceptable: -3, furious: -3, scam: -3, scammed: -3, rubbish: -3, garbage: -3,
  hate: -3, outrageous: -3, incompetent: -3, nonsense: -2.5, angry: -2.5, livid: -3,
  disappointed: -2, disappointing: -2, frustrated: -2, frustrating: -2, annoyed: -2, annoying: -2,
  upset: -2, unhappy: -2, worse: -2, bad: -2, poor: -2, broken: -2, damaged: -2, cheated: -3,
  rude: -2, wrong: -1.5, late: -1, delayed: -1.5, slow: -1, problem: -1, issue: -1, fed: -1,
  complaint: -1.5, sick: -1.5, waste: -2, wasted: -2, lied: -2.5, lying: -2.5, liar: -3,
  // English, positive
  thanks: 2, thank: 2, thx: 1.5, great: 2, good: 1.5, excellent: 3, amazing: 3, awesome: 3,
  perfect: 3, love: 2.5, happy: 2, helpful: 2, nice: 1.5, wonderful: 3, fantastic: 3,
  appreciate: 2, satisfied: 2, glad: 2, brilliant: 3, resolved: 1,
  // Roman Urdu
  bakwas: -3, bekar: -2.5, bekaar: -2.5, ghatiya: -3, fazool: -2, dhoka: -3, dhokha: -3,
  ghussa: -2.5, gussa: -2.5, naraz: -2, naraaz: -2, pareshan: -2, mayoos: -2, bura: -2,
  ganda: -2, lanat: -3, shikayat: -1.5, zaleel: -3, zalil: -3,
  shukriya: 2, shukria: 2, acha: 1.5, achha: 1.5, accha: 1.5, zabardast: 3, behtareen: 3,
  khush: 2, kamal: 2.5, mehrbani: 2,
  // Urdu
  "بکواس": -3, "بیکار": -2.5, "گھٹیا": -3, "دھوکہ": -3, "دھوکا": -3, "غصہ": -2.5, "ناراض": -2,
  "پریشان": -2, "مایوس": -2, "برا": -2, "شکایت": -1.5,
  "شکریہ": 2, "اچھا": 1.5, "بہترین": 3, "خوش": 2, "زبردست": 3, "مہربانی": 2,
};

/** Multi-word expressions, checked before single words. */
const PHRASES: Array<[string, number]> = [
  ["fed up", -2.5], ["rip off", -3], ["waste of time", -2.5], ["waste of money", -2.5],
  ["not working", -2], ["doesnt work", -2], ["does not work", -2], ["still waiting", -2],
  ["no one is helping", -2.5], ["nobody is helping", -2.5], ["never again", -2.5],
  ["pagal bana", -3], ["time zaya", -2.5], ["kaam nahi kar", -2],
  ["thank you", 2], ["very helpful", 2.5], ["well done", 2.5],
];

const NEGATIONS = new Set([
  "not", "no", "never", "dont", "didnt", "doesnt", "isnt", "wasnt", "arent", "cant", "cannot",
  "wont", "hardly", "nahi", "nahin", "nai", "na", "mat", "نہیں", "نہ", "مت",
]);
const INTENSIFIERS = new Set([
  "very", "so", "extremely", "really", "totally", "absolutely", "completely", "super", "too",
  "bohat", "bahut", "boht", "bht", "buhat", "intehai", "bilkul", "بہت", "انتہائی", "بالکل",
]);

function tokens(text: string) {
  return (text.normalize("NFKC").toLowerCase().replace(/[’']/g, "").match(/[\p{L}\p{N}]+/gu) ?? []);
}

/**
 * Sentiment of one message from -1 (very negative) to 1 (very positive); 0 is neutral.
 * Negation within the three words before a sentiment word flips and softens it
 * (in Roman Urdu and Urdu the negation usually comes after: "acha nahi").
 */
export function scoreSentiment(text: string) {
  const words = tokens(text);
  if (words.length === 0) return 0;

  const joined = ` ${words.join(" ")} `;
  let total = 0;
  const used = new Set<number>();

  for (const [phrase, weight] of PHRASES) {
    const at = joined.indexOf(` ${phrase} `);
    if (at >= 0) {
      total += weight;
      const start = joined.slice(0, at).trim().split(" ").filter(Boolean).length;
      phrase.split(" ").forEach((_, i) => used.add(start + i));
    }
  }

  words.forEach((word, index) => {
    if (used.has(index)) return;
    const base = LEXICON[word];
    if (base === undefined) return;
    let weight = base;
    const before = words.slice(Math.max(0, index - 3), index);
    const after = words.slice(index + 1, index + 3);
    if (before.some((w) => NEGATIONS.has(w)) || after.some((w) => NEGATIONS.has(w))) {
      weight = -weight * 0.6;
    }
    if (before.slice(-2).some((w) => INTENSIFIERS.has(w))) {
      weight *= 1.5;
    }
    total += weight;
  });

  // Shouting makes a negative message more negative.
  if (total < 0) {
    const shouted = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
    if (/!{2,}/.test(text)) total -= 0.75;
    if (shouted >= 2) total -= 0.75;
  }

  const score = total / (Math.abs(total) + 3);
  return Math.round(score * 100) / 100;
}

// ------------------------------------------------------------------ requests for a person

const HUMAN_REQUEST = [
  /\b(talk|speak|chat|connect|transfer)( me)? (to|with) (a |an |your |some )?(real |actual |live )?(human|person|people|agent|representative|rep|someone|somebody|manager|supervisor|staff|team|operator)\b/,
  /\b(i |we )?(want|need|would like|wanna) (a |an |to talk to a |to speak to a |to speak with a )?(real |actual |live )?(human|person|agent|representative|manager|supervisor)\b/,
  /\b(real|actual|live) (human|person|agent)\b/,
  /\bhuman (agent|support|being)\b/,
  /\b(customer|support) (care|service)? ?(agent|representative|rep)\b/,
  /\b(insaan|insan|bande|banday|bandey|kisi agent|kisi insan|kisi insaan|asli banda|manager|staff) (se|say|sey) (baat|bat)\b/,
  /\bkisi (se|say) baat (karwa|karao|karwao|krwa)/,
  /انسان سے بات|کسی نمائندے|کسی بندے سے بات/,
];
/** Questions about the assistant itself are not a request for a person. */
const IDENTITY_QUESTION = /\b(are|r) (you|u) (a |an )?(real |actual )?(human|person|bot|robot|ai)\b|\bkya (aap|ap|tum) (insaan|insan|bot|robot)\b/;

export function isHumanRequest(text: string) {
  const normal = ` ${tokens(text).join(" ")} `;
  const raw = text.normalize("NFKC");
  if (IDENTITY_QUESTION.test(normal)) return false;
  return HUMAN_REQUEST.some((pattern) => pattern.test(normal) || pattern.test(raw));
}

// ------------------------------------------------------------------ sensitive topics and trigger phrases

const SENSITIVE_TOPICS: Array<{ label: string; priority: EscalationPriority; phrases: string[] }> = [
  {
    label: "safety concern",
    priority: "URGENT",
    phrases: ["suicide", "kill myself", "self harm", "hurt myself", "end my life", "threaten", "khudkushi", "خودکشی"],
  },
  {
    label: "legal action",
    priority: "HIGH",
    phrases: ["lawyer", "legal action", "sue you", "sue your", "court", "police", "consumer court", "wakeel", "vakeel", "عدالت", "پولیس", "وکیل"],
  },
  {
    label: "payment dispute",
    priority: "HIGH",
    phrases: ["chargeback", "charged twice", "double charged", "unauthorized charge", "unauthorised charge", "dispute the charge", "money deducted", "paise kat"],
  },
  {
    label: "fraud or account security",
    priority: "HIGH",
    phrases: ["fraud", "scam", "hacked", "stolen", "data breach", "identity theft", "someone logged into my account", "dhoka", "dhokha"],
  },
  {
    label: "cancellation",
    priority: "MEDIUM",
    phrases: ["cancel my account", "close my account", "cancel my subscription", "delete my account", "account band"],
  },
];

function containsPhrase(text: string, phrase: string) {
  const haystack = ` ${tokens(text).join(" ")} `;
  const needle = tokens(phrase).join(" ");
  return needle.length > 0 && haystack.includes(` ${needle} `);
}

export function matchSensitiveTopic(text: string) {
  for (const topic of SENSITIVE_TOPICS) {
    const phrase = topic.phrases.find((p) => containsPhrase(text, p));
    if (phrase) return { label: topic.label, priority: topic.priority, phrase };
  }
  return null;
}

export function matchKeyword(text: string, keywords: string[]) {
  return keywords.map((k) => k.trim()).find((k) => k && containsPhrase(text, k)) ?? null;
}

// ------------------------------------------------------------------ decision

export type EscalationDecision = {
  trigger: EscalationTrigger;
  reason: string;
  priority: EscalationPriority;
  sentimentScore: number | null;
};

const quote = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return `"${clean.length > 90 ? `${clean.slice(0, 89)}…` : clean}"`;
};

/**
 * Whether this customer message must go to a human, and why. `recentSentiments` are the
 * scores of the customer's previous messages in this conversation (newest last).
 * Checked in order of importance: a customer kept with the team, sensitive topics and
 * trigger phrases, a request for a person, then sentiment.
 */
export function evaluateEscalation({
  message,
  settings,
  recentSentiments = [],
  contactAiPaused = false,
}: {
  message: string;
  settings: EscalationSettings;
  recentSentiments?: number[];
  contactAiPaused?: boolean;
}): { sentiment: number; decision: EscalationDecision | null } {
  const sentiment = scoreSentiment(message);

  if (!settings.enabled) {
    return { sentiment, decision: null };
  }

  if (contactAiPaused) {
    return {
      sentiment,
      decision: { trigger: "CUSTOMER_FLAGGED", reason: "This customer is kept with the team.", priority: "MEDIUM", sentimentScore: sentiment },
    };
  }

  if (settings.sensitiveTopics) {
    const topic = matchSensitiveTopic(message);
    if (topic) {
      return {
        sentiment,
        decision: { trigger: "KEYWORD", reason: `Sensitive topic (${topic.label}): ${quote(message)}`, priority: topic.priority, sentimentScore: sentiment },
      };
    }
  }

  const keyword = matchKeyword(message, settings.keywords);
  if (keyword) {
    return {
      sentiment,
      decision: { trigger: "KEYWORD", reason: `Trigger phrase "${keyword}": ${quote(message)}`, priority: "HIGH", sentimentScore: sentiment },
    };
  }

  if (settings.onHumanRequest && isHumanRequest(message)) {
    return {
      sentiment,
      decision: { trigger: "HUMAN_REQUEST", reason: `Customer asked for a person: ${quote(message)}`, priority: sentiment <= settings.sentimentThreshold ? "HIGH" : "MEDIUM", sentimentScore: sentiment },
    };
  }

  if (settings.sentimentEnabled && sentiment < 0) {
    const threshold = settings.sentimentThreshold;
    const window = [...recentSentiments.slice(-2), sentiment];
    const average = window.reduce((sum, value) => sum + value, 0) / window.length;
    const negativeCount = window.filter((value) => value < 0).length;
    const single = sentiment <= threshold;
    // Building frustration: three negative messages in a row, close to the threshold.
    const sustained = window.length >= 3 && negativeCount === 3 && average <= threshold + 0.15;

    if (single || sustained) {
      return {
        sentiment,
        decision: {
          trigger: "SENTIMENT",
          reason: single
            ? `Negative sentiment (${sentiment.toFixed(2)}): ${quote(message)}`
            : `Growing frustration over the last ${window.length} messages (average ${average.toFixed(2)}): ${quote(message)}`,
          priority: sentiment <= -0.75 ? "HIGH" : "MEDIUM",
          sentimentScore: sentiment,
        },
      };
    }
  }

  return { sentiment, decision: null };
}

/** When the team must accept an escalation (SLA), from its creation time. */
export function slaDueAt(createdAt: Date, slaMinutes: number) {
  return new Date(createdAt.getTime() + Math.max(1, slaMinutes) * 60_000);
}

/** Settings as stored in WorkspaceSetting, with defaults for a workspace without a row. */
export function escalationSettingsFrom(row: {
  escalationEnabled: boolean;
  escalationSentimentEnabled: boolean;
  escalationSentimentThreshold: number;
  escalationOnHumanRequest: boolean;
  escalationSensitiveTopics: boolean;
  escalationKeywords: string[];
  escalationSlaMinutes: number;
} | null | undefined): EscalationSettings {
  if (!row) return { ...DEFAULT_ESCALATION_SETTINGS };
  return {
    enabled: row.escalationEnabled,
    sentimentEnabled: row.escalationSentimentEnabled,
    sentimentThreshold: row.escalationSentimentThreshold,
    onHumanRequest: row.escalationOnHumanRequest,
    sensitiveTopics: row.escalationSensitiveTopics,
    keywords: row.escalationKeywords,
    slaMinutes: row.escalationSlaMinutes,
  };
}
