import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, makeAccount, withRole } from '../../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../../test/utils.tsx';

const newcomer = makeAccount({ username: 'newcomer', displayName: 'Newcomer' });

describe('moderation area', () => {
  it('is hidden from regular users, who are sent home', async () => {
    const fetchMock = mockApi({ 'GET /me': { body: aliceUser }, 'GET /instance': instance() });
    const { router } = renderApp('/admin/pending');
    await screen.findByRole('heading', { name: 'Home' });
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByRole('link', { name: /Moderation/ })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/admin/'))).toBe(false);
  });

  it('shows moderators a nav item with the number of open items', async () => {
    mockApi({
      'GET /me': { body: withRole('moderator') },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 2, openReports: 1 } },
    });
    renderApp('/');
    const links = await screen.findAllByRole('link', { name: /Moderation/ });
    expect(links[0]).toHaveAttribute('href', '/admin');
    expect((await screen.findAllByText('3 items waiting for moderators')).length).toBeGreaterThan(
      0,
    );
  });

  it('approves a pending registration and shows the reason first', async () => {
    let approved = false;
    const fetchMock = mockApi({
      'GET /me': { body: withRole('admin') },
      'GET /instance': instance('approval'),
      'GET /admin/summary': () => ({
        body: { pendingUsers: approved ? 0 : 1, openReports: 0 },
      }),
      'GET /admin/pending': () => ({
        body: approved
          ? []
          : [
              {
                userId: 'u-1',
                email: 'new@example.com',
                reason: 'I run a diaspora pod',
                createdAt: new Date().toISOString(),
                account: newcomer,
              },
            ],
      }),
      'POST /admin/pending/u-1/approve': () => {
        approved = true;
        return { body: { status: 'ok' } };
      },
    });
    renderApp('/admin/pending');
    const user = userEvent.setup();

    expect(await screen.findByText('I run a diaspora pod')).toBeInTheDocument();
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve @newcomer' }));

    expect(
      await screen.findByText('@newcomer has been approved and can now sign in.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('I run a diaspora pod')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === '/api/v1/admin/pending/u-1/approve' && init?.method === 'POST',
      ),
    ).toBe(true);
    await waitFor(() =>
      expect(screen.queryByText('1 item waiting for moderators')).not.toBeInTheDocument(),
    );
  });

  it('lets only administrators change roles and block domains', async () => {
    mockApi({
      'GET /me': { body: withRole('moderator') },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 0, openReports: 0 } },
      'GET /admin/accounts': {
        body: [
          {
            account: newcomer,
            domain: null,
            suspended: false,
            user: {
              id: 'u-2',
              email: 'n@example.com',
              role: 'user',
              approved: true,
              lastSignInAt: null,
            },
          },
        ],
      },
      'GET /admin/domain_blocks': { body: [] },
    });
    renderApp('/admin/accounts');
    const user = userEvent.setup();
    const list = await within(await screen.findByRole('main')).findByRole('list');
    expect(within(list).getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
    expect(within(list).queryByRole('combobox', { name: 'Role' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Domain blocks' }));
    expect(
      await screen.findByText('Only administrators can add or remove domain blocks.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Block server' })).not.toBeInTheDocument();
  });
});
