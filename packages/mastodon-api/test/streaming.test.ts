import type { Account, Notification, Status } from '@disbigle/shared';
import { describe, expect, it } from 'vitest';
import { mapContext } from '../src/entities/mappers.ts';
import { MastodonStreamEncoder, type Subscription, toSubscription } from '../src/streaming.ts';

const account = (id: string, local: boolean): Account => ({
  id,
  username: id,
  acct: local ? id : `${id}@remote.example`,
  displayName: id,
  note: '',
  avatarUrl: null,
  headerUrl: null,
  fields: [],
  locked: false,
  bot: false,
  discoverable: true,
  local,
  url: null,
  createdAt: '2026-10-11T00:00:00.000Z',
});

const status = (id: string, author: Account, media = false): Status => ({
  id,
  uri: null,
  url: null,
  createdAt: '2026-10-11T00:00:00.000Z',
  editedAt: null,
  account: author,
  content: '<p>x</p>',
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
  media: media
    ? [
        {
          id: 'm',
          type: 'image',
          url: 'https://x/m.png',
          previewUrl: null,
          description: '',
          width: 1,
          height: 1,
          blurhash: null,
        },
      ]
    : [],
  poll: null,
  liked: false,
  reblogged: false,
  bookmarked: false,
});

async function sub(stream: string, extra: { tag?: string; list?: string } = {}) {
  const result = await toSubscription({ stream, ...extra }, true, async (id) =>
    id === 'friends' ? new Set(['friend']) : null,
  );
  if ('error' in result) throw new Error(result.error);
  return result as Subscription;
}

describe('Mastodon streaming encoder', () => {
  it('maps subscriptions to native hub streams and rejects unknown ones', async () => {
    expect((await sub('hashtag', { tag: '#Fediverse' })).native).toBe('hashtag:fediverse');
    expect((await sub('public:local:media')).native).toBe('public:local');
    expect((await sub('list', { list: 'friends' })).native).toBe('user');
    expect(await toSubscription({ stream: 'user' }, false, async () => null)).toEqual({
      error: 'Missing access token',
      status: 401,
    });
    expect(await toSubscription({ stream: 'list', list: 'x' }, true, async () => null)).toEqual({
      error: 'No such list',
      status: 400,
    });
    expect(await toSubscription({ stream: 'direct' }, true, async () => null)).toMatchObject({
      status: 400,
    });
  });

  it('re-encodes native events with the payload as a JSON string', async () => {
    const encoder = new MastodonStreamEncoder(mapContext('https://disbigle.test'), true);
    encoder.add(await sub('user'));
    encoder.add(await sub('list', { list: 'friends' }));
    encoder.add(await sub('public:media'));
    expect(encoder.nativeStreams()).toEqual(new Set(['user', 'public']));

    const fromFriend = status('s1', account('friend', true));
    const [user, listEvent] = encoder.encode({
      event: 'update',
      stream: 'user',
      payload: fromFriend,
    });
    expect(JSON.parse(user ?? '')).toMatchObject({ stream: ['user'], event: 'update' });
    const parsed = JSON.parse(listEvent ?? '');
    expect(parsed.stream).toEqual(['list', 'friends']);
    expect(typeof parsed.payload).toBe('string');
    expect(JSON.parse(parsed.payload)).toMatchObject({ id: 's1', favourites_count: 0 });

    // Not a list member: only the user stream gets it.
    expect(
      encoder.encode({
        event: 'update',
        stream: 'user',
        payload: status('s2', account('x', true)),
      }),
    ).toHaveLength(1);
    // public:media filters out posts without media.
    expect(
      encoder.encode({
        event: 'update',
        stream: 'public',
        payload: status('s3', account('x', true)),
      }),
    ).toHaveLength(0);
    expect(
      encoder.encode({
        event: 'update',
        stream: 'public',
        payload: status('s4', account('x', true), true),
      }),
    ).toHaveLength(1);

    const deleted = encoder.encode({ event: 'delete', stream: 'user', payload: 's1' });
    expect(deleted.map((d) => JSON.parse(d))).toEqual([
      { stream: ['user'], event: 'delete', payload: 's1' },
    ]);

    const notification: Notification = {
      id: 'n1',
      type: 'like',
      createdAt: '2026-10-11T00:00:00.000Z',
      read: false,
      account: account('friend', true),
      status: fromFriend,
    };
    const [note] = encoder.encode({ event: 'notification', stream: 'user', payload: notification });
    expect(JSON.parse(JSON.parse(note ?? '').payload)).toMatchObject({
      id: 'n1',
      type: 'favourite',
    });

    encoder.remove('user');
    expect(
      encoder.encode({ event: 'notification', stream: 'user', payload: notification }),
    ).toHaveLength(0);
  });
});
