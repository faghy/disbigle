import type { Account, Status } from '@disbigle/shared';
import { describe, expect, it } from 'vitest';
import { deriveFlavour } from '../src/dispatch.ts';
import {
  mapAccount,
  mapContext,
  mapStatus,
  mapVisibility,
  nativeNotificationTypes,
  parseVisibility,
} from '../src/entities/mappers.ts';
import { list, parseBracketPairs, parseFormBody, strings } from '../src/http.ts';
import { isKnownScope, parseScopes, scopeAllows, scopesWithin } from '../src/oauth/scopes.ts';
import { toCreateRequest } from '../src/routes/statuses.ts';

describe('bracket-notation forms', () => {
  it('builds nested objects and arrays the Rails way', () => {
    const form = parseFormBody(
      'status=hi&media_ids[]=a&media_ids[]=b&poll[options][]=x&poll[options][]=y&poll[expires_in]=300&fields_attributes[0][name]=n&fields_attributes[0][value]=v&visibility=private&visibility=direct',
    );
    expect(form).toEqual({
      status: 'hi',
      media_ids: ['a', 'b'],
      poll: { options: ['x', 'y'], expires_in: '300' },
      fields_attributes: { '0': { name: 'n', value: 'v' } },
      visibility: 'direct',
    });
    expect(list(form.fields_attributes)).toEqual([{ name: 'n', value: 'v' }]);
    expect(strings(parseBracketPairs([['id', 'one']]).id)).toEqual(['one']);
  });

  it('maps a form-encoded status with a poll to our create request', () => {
    const request = toCreateRequest(
      parseFormBody(
        'status=Vote!&visibility=private&poll[options][]=yes&poll[options][]=no&poll[expires_in]=60&poll[multiple]=true&language=it&sensitive=1&spoiler_text=cw',
      ),
    );
    expect(request).toMatchObject({
      content: 'Vote!',
      visibility: 'followers',
      language: 'it',
      sensitive: true,
      summary: 'cw',
      // Clamped to our minimum of five minutes.
      poll: { options: ['yes', 'no'], expiresIn: 300, multiple: true },
    });
    expect(() => toCreateRequest({ status: 'x', scheduled_at: '2030-01-01' })).toThrow(/scheduled/);
    expect(() => toCreateRequest({ status: 'x', media_ids: ['nope'] })).toThrow(/media/);
  });
});

describe('scopes', () => {
  it('accepts Mastodon scopes and expands top-level ones', () => {
    expect(parseScopes('read write+follow')).toEqual(['read', 'write', 'follow']);
    expect(parseScopes(undefined)).toEqual(['read']);
    expect(isKnownScope('read:statuses')).toBe(true);
    expect(isKnownScope('admin:read:accounts')).toBe(true);
    expect(isKnownScope('read:everything')).toBe(false);
    expect(scopeAllows(['read'], 'read:notifications')).toBe(true);
    expect(scopeAllows(['follow'], 'write:blocks')).toBe(true);
    expect(scopeAllows(['read:statuses'], 'read')).toBe(false);
    expect(scopeAllows(['write'], 'read:statuses')).toBe(false);
    expect(scopesWithin(['read:lists', 'write'], ['read', 'write', 'follow'])).toBe(true);
    expect(scopesWithin(['push'], ['read'])).toBe(false);
  });
});

describe('API flavour dispatch', () => {
  const options = { anonymous: 'mastodon' as const, sessionCookie: 'disbigle_session' };
  const derive = (url: string, headers: Record<string, string> = {}) =>
    deriveFlavour({ url, headers }, options);

  it('routes OAuth requests to Mastodon and the web client to the native API', () => {
    expect(derive('/api/v1/statuses/1', { authorization: 'Bearer abc' })).toBe('mastodon');
    expect(derive('/api/v1/streaming?stream=user&access_token=abc')).toBe('mastodon');
    expect(derive('/api/v1/instance', { cookie: 'a=1; disbigle_session=xyz' })).toBe('native');
    expect(derive('/api/v1/instance', { 'sec-fetch-site': 'same-origin' })).toBe('native');
    expect(derive('/api/v1/instance', { 'sec-fetch-site': 'cross-site' })).toBe('mastodon');
    expect(derive('/api/v1/instance')).toBe('mastodon');
    expect(derive('/api/v1/instance', { 'x-disbigle-api': 'native' })).toBe('native');
    expect(
      derive('/api/v1/instance', { 'x-disbigle-api': 'mastodon', cookie: 'disbigle_session=1' }),
    ).toBe('mastodon');
    expect(derive('/users/alice')).toBeUndefined();
    expect(
      deriveFlavour({ url: '/api/v1/instance', headers: {} }, { ...options, anonymous: 'native' }),
    ).toBe('native');
  });
});

const account: Account = {
  id: '01920000-0000-7000-8000-000000000001',
  username: 'alice',
  acct: 'alice',
  displayName: 'Alice',
  note: 'Hello <world>\n\nSecond',
  avatarUrl: null,
  headerUrl: null,
  fields: [{ name: 'Site', value: 'https://example.org' }],
  locked: false,
  bot: false,
  discoverable: true,
  local: true,
  url: 'https://disbigle.test/@alice',
  createdAt: '2026-10-11T00:00:00.000Z',
  movedToId: null,
};

describe('entity mapping', () => {
  const ctx = mapContext('https://disbigle.test');

  it('maps accounts with HTML notes, default images and linked fields', () => {
    const mapped = mapAccount(ctx, account);
    expect(mapped).toMatchObject({
      id: account.id,
      acct: 'alice',
      display_name: 'Alice',
      note: '<p>Hello &lt;world&gt;</p><p>Second</p>',
      avatar: 'https://disbigle.test/assets/user/default.png',
      header: 'https://disbigle.test/api/mastodon/missing-header.png',
      followers_count: 0,
      emojis: [],
    });
    expect(mapped.fields[0]?.value).toContain('<a href="https://example.org"');
    expect(mapAccount(ctx, { ...account, local: false, note: '<p>remote</p>' }).note).toBe(
      '<p>remote</p>',
    );
  });

  it('maps visibilities and notification types both ways', () => {
    expect(mapVisibility('limited')).toBe('private');
    expect(mapVisibility('followers')).toBe('private');
    expect(parseVisibility('private')).toBe('followers');
    expect(parseVisibility('nonsense')).toBeUndefined();
    expect(nativeNotificationTypes(['mention', 'favourite', 'status'])).toEqual([
      'mention',
      'reply',
      'like',
    ]);
  });

  it('maps statuses with viewer flags only when signed in', () => {
    const status: Status = {
      id: '01920000-0000-7000-8000-000000000002',
      uri: 'https://disbigle.test/users/alice/statuses/2',
      url: 'https://disbigle.test/@alice/2',
      createdAt: '2026-10-11T00:00:00.000Z',
      editedAt: null,
      account,
      content: '<p>hi</p>',
      summary: '',
      sensitive: false,
      visibility: 'limited',
      language: null,
      inReplyToId: null,
      inReplyToAccountId: null,
      reblog: null,
      repliesCount: 1,
      reblogsCount: 2,
      likesCount: 3,
      mentions: [],
      tags: [{ name: 'tag' }],
      media: [],
      poll: null,
      liked: true,
      reblogged: false,
      bookmarked: false,
    };
    const signedIn = mapStatus(ctx, status, { signedIn: true });
    expect(signedIn).toMatchObject({
      visibility: 'private',
      favourites_count: 3,
      favourited: true,
      tags: [{ name: 'tag', url: 'https://disbigle.test/tags/tag' }],
      card: null,
      application: null,
    });
    expect('favourited' in mapStatus(ctx, status, { signedIn: false })).toBe(false);
  });
});
