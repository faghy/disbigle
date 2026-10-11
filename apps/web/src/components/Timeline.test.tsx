import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, bob, makeNotification, makeStatus } from '../test/fixtures.ts';
import { MockWebSocket } from '../test/mockWebSocket.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

async function openSocket() {
  await waitFor(() => expect(MockWebSocket.latest()?.subscriptions).toContain('user'));
  const socket = MockWebSocket.latest();
  if (!socket) throw new Error('no socket');
  return socket;
}

describe('live home timeline', () => {
  it('holds new posts behind a pill instead of shifting the list', async () => {
    const first = makeStatus({ content: '<p>First post</p>' });
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [first] },
    });
    renderApp('/');
    await screen.findByText('First post');
    const socket = await openSocket();
    expect(socket.url).toMatch(/\/api\/v1\/streaming$/);

    const fresh = makeStatus({ account: bob, content: '<p>Fresh news</p>' });
    act(() => socket.receive({ event: 'update', stream: 'user', payload: fresh }));
    act(() => socket.receive({ event: 'update', stream: 'user', payload: fresh }));

    const pill = await screen.findByRole('button', { name: '1 new post' });
    expect(screen.queryByText('Fresh news')).not.toBeInTheDocument();

    await userEvent.setup().click(pill);
    expect(await screen.findByText('Fresh news')).toBeInTheDocument();
    const articles = screen.getAllByRole('article');
    expect(articles[0]).toHaveTextContent('Fresh news');
    expect(screen.queryByRole('button', { name: /new post/ })).not.toBeInTheDocument();
  });

  it('shows your own posts at once and removes deleted posts', async () => {
    const first = makeStatus({ content: '<p>Soon gone</p>' });
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [first] },
    });
    renderApp('/');
    await screen.findByText('Soon gone');
    const socket = await openSocket();

    const mine = makeStatus({ account: aliceUser.account, content: '<p>From my phone</p>' });
    act(() => socket.receive({ event: 'update', stream: 'user', payload: mine }));
    expect(await screen.findByText('From my phone')).toBeInTheDocument();

    act(() => socket.receive({ event: 'delete', stream: 'user', payload: first.id }));
    await waitFor(() => expect(screen.queryByText('Soon gone')).not.toBeInTheDocument());
  });

  it('bumps the unread badge when a notification arrives', async () => {
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /notifications/unread_count': { body: { count: 1 } },
    });
    renderApp('/');
    // The count lives on the bell at the top right.
    expect(
      await screen.findByRole('button', { name: 'Notifications, 1 unread notification' }),
    ).toHaveTextContent('1');
    const socket = await openSocket();
    act(() =>
      socket.receive({ event: 'notification', stream: 'user', payload: makeNotification() }),
    );
    expect(
      await screen.findByRole('button', { name: 'Notifications, 2 unread notifications' }),
    ).toHaveTextContent('2');
  });
});
