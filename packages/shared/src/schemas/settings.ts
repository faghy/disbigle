/** A personal invitation link. */
export interface Invite {
  id: string;
  code: string;
  url: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
}

export type FilterContext = 'home' | 'public' | 'notifications' | 'thread';

/** A muted word or phrase. */
export interface KeywordFilter {
  id: string;
  phrase: string;
  wholeWord: boolean;
  contexts: FilterContext[];
  expiresAt: string | null;
}

/** An app authorized through OAuth. */
export interface AuthorizedApp {
  id: string;
  name: string;
  website: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export type PushAlertType =
  | 'follow'
  | 'follow_request'
  | 'mention'
  | 'reply'
  | 'reblog'
  | 'like'
  | 'poll';

export interface PushSubscriptionInfo {
  endpoint: string;
  alerts: Record<PushAlertType, boolean>;
}
