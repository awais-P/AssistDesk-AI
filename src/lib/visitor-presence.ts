/**
 * Which website visitors have the chat open right now (Chats FR-6.2, the green dot).
 *
 * The widget keeps a live connection while it is open and checks in every few seconds
 * (the stream's poll, or its polling fallback); each check-in marks the conversation as
 * seen. A conversation is "online" while it was seen in the last 30 seconds. The Chats
 * page's live stream sends the online list whenever it changes.
 *
 * Kept in memory per server process (like the event bus): with several instances, a
 * visitor connected to another instance shows as offline until they write.
 */
export const VISITOR_ONLINE_WINDOW_MS = 30_000;

type Seen = { workspaceId: string; at: number };

declare global {
  var assistdeskVisitorPresence: Map<string, Seen> | undefined;
}

const seen = (global.assistdeskVisitorPresence ??= new Map<string, Seen>());

export function markVisitorSeen(sessionId: string, workspaceId: string, now = Date.now()) {
  seen.set(sessionId, { workspaceId, at: now });
}

export function markVisitorGone(sessionId: string) {
  seen.delete(sessionId);
}

/** Conversations of this workspace whose visitor is online, oldest entries forgotten. */
export function onlineVisitorSessions(workspaceId: string, now = Date.now()) {
  const online: string[] = [];

  for (const [sessionId, entry] of seen) {
    if (now - entry.at > VISITOR_ONLINE_WINDOW_MS) {
      seen.delete(sessionId);
    } else if (entry.workspaceId === workspaceId) {
      online.push(sessionId);
    }
  }

  return online.sort();
}

export function resetVisitorPresenceForTests() {
  seen.clear();
}
