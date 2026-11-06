import type { ActivityItem } from '@disbigle/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, bob, makeStatus } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

const item = (type: ActivityItem['type'], content: string): ActivityItem => ({
  id: `c-${type}`,
  type,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  status: makeStatus({ account: bob, content: `<p>${content}</p>` }),
});

describe('my activity', () => {
  it('lists what you did, and one kind at a time', async () => {
    const types: (string | null)[] = [];
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/activity': (_body, url) => {
        const type = url.searchParams.get('type');
        types.push(type);
        const items =
          type === 'like'
            ? [item('like', 'Bella foto')]
            : [item('bookmark', 'Da leggere'), item('like', 'Bella foto')];
        return { body: { items, next: null } };
      },
    });
    renderApp('/activity');
    const user = userEvent.setup();
    const feed = await screen.findByRole('feed', { name: 'My activity' });
    const posts = within(feed).getAllByRole('article');
    expect(posts).toHaveLength(2);
    expect(within(posts[0] as HTMLElement).getByText('You saved')).toBeInTheDocument();
    expect(within(posts[1] as HTMLElement).getByText('You liked')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Likes' }));
    expect(await screen.findByText('Bella foto')).toBeInTheDocument();
    expect(screen.queryByText('Da leggere')).not.toBeInTheDocument();
    expect(types).toEqual([null, 'like']);
  });

  it('is in the menu', async () => {
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [] },
    });
    renderApp('/');
    expect((await screen.findAllByRole('link', { name: 'My activity' })).length).toBeGreaterThan(0);
  });
});
