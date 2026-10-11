import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../../test/utils.tsx';

const servers = [
  {
    domain: 'mastodon.example',
    accounts: 12,
    protocols: ['activitypub'],
    followersOfLocalAccounts: 3,
    lastSeenAt: new Date(Date.now() - 3_600_000).toISOString(),
    block: null,
  },
  {
    domain: 'pod.example',
    accounts: 1,
    protocols: ['diaspora', 'activitypub'],
    followersOfLocalAccounts: 0,
    lastSeenAt: null,
    block: 'silence',
  },
];

const routes = (role: 'admin' | 'moderator') => ({
  'GET /me': { body: withRole(role) },
  'GET /instance': instance(),
  'GET /admin/summary': { body: { pendingUsers: 0, openReports: 0 } },
  'GET /admin/instances': (_body: unknown, url: URL) => ({
    body: servers.filter((s) => s.domain.includes(url.searchParams.get('q') ?? '')),
  }),
  'GET /admin/domain_blocks': { body: [] },
});

describe('federation tab', () => {
  it('lists known servers and opens the block form prefilled', async () => {
    mockApi(routes('admin'));
    const { router } = renderApp('/admin/federation');
    const user = userEvent.setup();

    const list = await within(await screen.findByRole('main')).findByRole('list');
    const [mastodon, pod] = within(list).getAllByRole('listitem');
    expect(mastodon).toHaveTextContent('ActivityPub');
    expect(mastodon).toHaveTextContent('12 accounts');
    expect(mastodon).toHaveTextContent('3 followers of local accounts');
    expect(pod).toHaveTextContent('diaspora*');
    expect(pod).toHaveTextContent('Silenced');

    await user.type(screen.getByRole('searchbox', { name: 'Search servers' }), 'pod');
    await waitFor(() =>
      expect(within(list).queryByText('mastodon.example')).not.toBeInTheDocument(),
    );

    await user.clear(screen.getByRole('searchbox', { name: 'Search servers' }));
    await user.click(await screen.findByRole('link', { name: 'Block mastodon.example' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/domains'));
    expect(await screen.findByRole('textbox', { name: 'Domain' })).toHaveValue('mastodon.example');
  });

  it('shows moderators the list without block actions', async () => {
    mockApi(routes('moderator'));
    renderApp('/admin/federation');
    expect(await screen.findByText('mastodon.example')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Block / })).not.toBeInTheDocument();
  });
});
