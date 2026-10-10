import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, bob, makeNotification, makeStatus } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

describe('notifications page', () => {
  it('accepts a follow request and marks everything as read', async () => {
    const request = makeNotification({ type: 'follow_request', account: bob });
    const like = makeNotification({
      type: 'like',
      status: makeStatus({ account: aliceUser.account, content: '<p>My first post</p>' }),
    });
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /notifications': { body: [request, like] },
      'GET /notifications/unread_count': { body: { count: 2 } },
      'POST /notifications/read': { body: { status: 'ok' } },
      [`POST /follow_requests/${bob.id}/authorize`]: {
        body: {
          id: bob.id,
          following: false,
          requested: false,
          followedBy: true,
          blocking: false,
          blockedBy: false,
          muting: false,
          aspectIds: [],
        },
      },
    });
    renderApp('/notifications');
    const user = userEvent.setup();

    const list = await screen.findByRole('list', { name: 'Notifications' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Bob asked to follow you');
    expect(items[1]).toHaveTextContent('liked your post');
    expect(items[1]).toHaveTextContent('My first post');

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === '/api/v1/notifications/read'),
      ).toBe(true),
    );

    await user.click(within(items[0] as HTMLElement).getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Follow request accepted.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === `/api/v1/follow_requests/${bob.id}/authorize` && init?.method === 'POST',
      ),
    ).toBe(true);
    expect(screen.queryByText(/unread notification/)).not.toBeInTheDocument();
  });
});
