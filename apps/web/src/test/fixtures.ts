import type { Account, CurrentUser, Notification, Relationship, Status } from '@disbigle/shared';

let counter = 0;
/** Time-ordered ids shaped like the server's UUIDv7s. */
export function nextId(): string {
  counter += 1;
  return `01a12800-0000-7000-8000-${String(counter).padStart(12, '0')}`;
}

export function makeAccount(overrides: Partial<Account> = {}): Account {
  const username = overrides.username ?? `user${counter}`;
  return {
    id: nextId(),
    username,
    acct: username,
    displayName: '',
    note: '',
    avatarUrl: null,
    headerUrl: null,
    fields: [],
    locked: false,
    bot: false,
    discoverable: true,
    local: true,
    url: `http://localhost/@${username}`,
    createdAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

export const alice = makeAccount({ username: 'alice', displayName: 'Alice Liddell' });
export const bob = makeAccount({ username: 'bob', displayName: 'Bob' });

export const aliceUser: CurrentUser = {
  account: alice,
  email: 'alice@example.com',
  role: 'user',
  locale: 'en',
  totpEnabled: false,
  passkeyCount: 0,
};

export function makeStatus(overrides: Partial<Status> = {}): Status {
  const id = overrides.id ?? nextId();
  return {
    id,
    uri: null,
    url: null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    poll: null,
    account: bob,
    content: '<p>Hello from Bob</p>',
    summary: '',
    sensitive: false,
    visibility: 'public',
    language: null,
    inReplyToId: null,
    inReplyToAccountId: null,
    inReplyToAccountAcct: null,
    reblog: null,
    repliesCount: 0,
    reblogsCount: 0,
    likesCount: 0,
    mentions: [],
    tags: [],
    media: [],
    liked: false,
    reblogged: false,
    bookmarked: false,
    ...overrides,
  };
}

export function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: nextId(),
    type: 'follow',
    createdAt: new Date().toISOString(),
    read: false,
    account: bob,
    status: null,
    ...overrides,
  };
}

export const relationship = (id: string, overrides: Partial<Relationship> = {}): Relationship => ({
  id,
  following: false,
  requested: false,
  followedBy: false,
  blocking: false,
  blockedBy: false,
  muting: false,
  aspectIds: [],
  ...overrides,
});

export const withRole = (role: CurrentUser['role']): CurrentUser => ({ ...aliceUser, role });
