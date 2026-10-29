import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, withRole } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

const navs = () => screen.getAllByRole('navigation', { name: 'Main' });
/** The bottom bar is the navigation that contains the "More" button. */
const bottomBar = () => {
  const nav = navs().find((n) => within(n).queryByRole('button', { name: /More/ }));
  if (!nav) throw new Error('no bottom bar');
  return nav;
};

describe('mobile navigation', () => {
  it('keeps four destinations and a More sheet with the rest', async () => {
    mockApi({
      'GET /me': { body: withRole('moderator') },
      'GET /instance': instance(),
      'GET /notifications/unread_count': { body: { count: 3 } },
      'GET /admin/summary': { body: { pendingUsers: 1, openReports: 1 } },
    });
    renderApp('/');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Home' });
    const bar = await waitFor(bottomBar);

    const labels = within(bar)
      .getAllByRole('listitem')
      .map((li) => li.textContent?.replace(/\d.*$/, '').trim());
    // Notifications are behind the bell at the top; aspects get their place in the bar.
    expect(labels).toEqual(['Home', 'Aspects', 'Messages', 'Search', 'More']);
    expect(
      screen.getByRole('button', { name: 'Notifications, 3 unread notifications' }),
    ).toHaveTextContent('3');
    expect(within(bar).getByRole('button', { name: /More/ })).toHaveTextContent('2');

    await user.click(within(bar).getByRole('button', { name: /More/ }));
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    const links = within(sheet)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/public/local',
      '/public',
      '/groups',
      '/contacts',
      '/bookmarks',
      '/settings',
      '/admin',
      '/about',
    ]);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(bar).getByRole('button', { name: /More/ })).toHaveFocus();
  });

  it('closes the More sheet after choosing a page', async () => {
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/bookmarks': { body: [] },
    });
    const { router } = renderApp('/');
    const user = userEvent.setup();
    const bar = await waitFor(bottomBar);
    await user.click(within(bar).getByRole('button', { name: /More/ }));
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    expect(within(sheet).queryByRole('link', { name: /Moderation/ })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('link', { name: 'Bookmarks' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/bookmarks'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the composer in a full-screen sheet from the floating button', async () => {
    mockApi({ 'GET /me': { body: aliceUser }, 'GET /instance': instance() });
    renderApp('/');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Home' });
    await user.click(screen.getByRole('button', { name: 'New post' }));
    const sheet = await screen.findByRole('dialog', { name: 'New post' });
    expect(within(sheet).getByRole('textbox', { name: 'New post' })).toHaveFocus();
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'New post' })).toHaveFocus();
  });

  it('hides the floating compose button in settings', async () => {
    mockApi({ 'GET /me': { body: aliceUser }, 'GET /instance': instance() });
    renderApp('/settings/account');
    await screen.findByRole('heading', { name: 'Account' });
    expect(screen.queryByRole('button', { name: 'New post' })).not.toBeInTheDocument();
  });
});
