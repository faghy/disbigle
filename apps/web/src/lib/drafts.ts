/**
 * Drafts of the composer, kept in this browser so a closed tab, a lost connection or a failed
 * send doesn't throw away what was written. One draft per account and per place (a new post, a
 * reply to a given post, a post in a given group). Attachments and polls are not kept.
 */

const PREFIX = 'disbigle:draft:';
/** Older drafts are forgotten. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface Draft {
  content: string;
  summary: string;
  savedAt: number;
}

export function draftKey(
  accountId: string,
  place: { replyToId?: string | undefined; groupId?: string | undefined },
): string {
  const where = place.replyToId
    ? `reply:${place.replyToId}`
    : place.groupId
      ? `group:${place.groupId}`
      : 'new';
  return `${PREFIX}${accountId}:${where}`;
}

export function loadDraft(key: string, now = Date.now()): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<Draft>;
    if (
      typeof draft.content !== 'string' ||
      typeof draft.savedAt !== 'number' ||
      now - draft.savedAt > MAX_AGE_MS
    ) {
      localStorage.removeItem(key);
      return null;
    }
    return {
      content: draft.content,
      summary: typeof draft.summary === 'string' ? draft.summary : '',
      savedAt: draft.savedAt,
    };
  } catch {
    return null;
  }
}

export function saveDraft(key: string, draft: Omit<Draft, 'savedAt'>, now = Date.now()): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ...draft, savedAt: now }));
  } catch {
    // Storage full or blocked: the draft just isn't kept.
  }
}

export function removeDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** Forgets every draft in this browser (on sign out, so the next person can't read them). */
export function clearDrafts(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing to do.
  }
}
