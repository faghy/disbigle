import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, makeNotification, makeStatus } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

describe('notification bell', () => {
  it('shows the unread count, lists the latest notifications and marks them read', async () => {
    let marked = false;
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /notifications/unread_count': () => ({ body: { count: marked ? 0 : 2 } }),
      'GET /notifications': {
        body: [
          makeNotification({
            type: 'like',
            status: makeStatus({ account: aliceUser.account, content: '<p>La mia gita</p>' }),
          }),
          makeNotification({ type: 'follow' }),
        ],
      },
      'POST /notifications/read': () => {
        marked = true;
        return { body: { status: 'ok' } };
      },
    });
    renderApp('/');
    const user = userEvent.setup();

    const bell = await screen.findByRole('button', {
      name: 'Notifications, 2 unread notifications',
    });
    expect(bell).toHaveTextContent('2');
    await user.click(bell);

    const panel = await screen.findByRole('region', { name: 'Notifications' });
    expect(await within(panel).findByText('La mia gita')).toBeInTheDocument();
    // The row opens the post; who did it links to their profile.
    expect(within(panel).getByRole('link', { name: 'liked your post' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/@alice\//),
    );
    expect(within(panel).getByRole('link', { name: 'followed you' })).toHaveAttribute(
      'href',
      '/@bob',
    );
    const bobLinks = within(panel).getAllByRole('link', { name: 'Bob' });
    expect(bobLinks.length).toBeGreaterThan(0);
    for (const link of bobLinks) expect(link).toHaveAttribute('href', '/@bob');
    expect(within(panel).getByRole('link', { name: 'See all notifications' })).toBeVisible();
    await waitFor(() => expect(marked).toBe(true));
    expect(screen.getByRole('button', { name: 'Notifications' })).not.toHaveTextContent(/\d/);

    await user.keyboard('{Escape}');
    expect(panel).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Notifications' })).toHaveFocus();
  });
});
