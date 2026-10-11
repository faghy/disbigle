import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { aliceUser, makeAccount, relationship } from '../test/fixtures.ts';
import { instance, mockApi, renderApp, signedOut } from '../test/utils.tsx';

describe('public profile', () => {
  it('renders the account with its full handle, bio and fields', async () => {
    mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'GET /accounts/lookup/bob': {
        body: {
          id: '2',
          username: 'bob',
          acct: 'bob',
          displayName: 'Bob',
          note: 'First line\nSecond line',
          avatarUrl: null,
          headerUrl: null,
          fields: [{ name: 'Website', value: 'https://bob.example' }],
          locked: false,
          bot: true,
          discoverable: true,
          local: true,
          url: null,
          createdAt: '2026-10-11T00:00:00.000Z',
        },
      },
    });
    renderApp('/@bob');
    expect(await screen.findByRole('heading', { name: 'Bob' })).toBeInTheDocument();
    expect(await screen.findByText('@bob@disbigle.test')).toBeInTheDocument();
    expect(screen.getByText(/First line/)).toHaveTextContent('First line Second line');
    expect(screen.getByText('Website')).toBeInTheDocument();
    expect(screen.getByText('Bot')).toBeInTheDocument();
  });

  it('shows a not-found state for unknown accounts', async () => {
    mockApi({ 'GET /me': signedOut, 'GET /instance': instance() });
    renderApp('/@nobody');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText('There is no account called @nobody here.')).toBeInTheDocument();
  });

  it('sends signed-out visitors from settings to the login page', async () => {
    mockApi({ 'GET /me': signedOut, 'GET /instance': instance() });
    const { router } = renderApp('/settings/profile');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('explains on a remote profile why followers-only posts are missing', async () => {
    const dora = makeAccount({
      id: 'dora-1',
      username: 'dora',
      acct: 'dora@remote.example',
      displayName: 'Dora',
      local: false,
    });
    const routes = (following: boolean) => ({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /accounts/lookup/dora@remote.example': { body: dora },
      'GET /accounts/relationships': { body: [relationship(dora.id, { following })] },
      [`GET /accounts/${dora.id}/statuses`]: { body: [] },
    });
    mockApi(routes(false));
    const first = renderApp('/@dora@remote.example');
    expect(await screen.findByText(/You only see Dora's public posts here/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send Dora a private message' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/messages\?to=dora(%40|@)remote\.example$/),
    );
    first.unmount();

    mockApi(routes(true));
    renderApp('/@dora@remote.example');
    expect(await screen.findByRole('heading', { name: 'Dora' })).toBeInTheDocument();
    await screen.findByRole('button', { name: /Unfollow/ });
    expect(screen.queryByText(/You only see Dora's public posts here/)).not.toBeInTheDocument();
  });
});
