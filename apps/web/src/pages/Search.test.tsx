import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, makeAccount, relationship } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

const remote = makeAccount({
  username: 'carol',
  acct: 'carol@mastodon.example',
  displayName: 'Carol',
  local: false,
  url: 'https://mastodon.example/@carol',
});

describe('search', () => {
  it('searches as you type and follows from the results', async () => {
    const dave = makeAccount({ username: 'dave', displayName: 'Dave' });
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /search/accounts': (_body, url) => ({
        body: url.searchParams.get('q') === 'dav' ? [dave] : [],
      }),
      'GET /accounts/relationships': { body: [relationship(dave.id)] },
      [`POST /accounts/${dave.id}/follow`]: {
        body: relationship(dave.id, { following: true }),
      },
    });
    renderApp('/search');
    const user = userEvent.setup();
    await user.type(await screen.findByRole('searchbox', { name: 'Search people' }), 'dav');

    const results = await screen.findByRole('list', { name: 'People' });
    expect(within(results).getByText('Dave')).toBeInTheDocument();
    // One batched relationships request for the whole list.
    const relationshipCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith('/api/v1/accounts/relationships'),
    );
    expect(relationshipCalls).toHaveLength(1);

    await user.click(await within(results).findByRole('button', { name: 'Follow Dave' }));
    expect(
      await within(results).findByRole('button', { name: 'Unfollow Dave' }),
    ).toBeInTheDocument();
  });

  it('looks up a remote handle on the network and shows a requested follow', async () => {
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /search/accounts': { body: [] },
      'POST /search/resolve': { body: remote },
      'GET /accounts/relationships': { body: [relationship(remote.id)] },
      [`POST /accounts/${remote.id}/follow`]: {
        body: relationship(remote.id, { requested: true }),
      },
    });
    renderApp('/search?q=%40carol%40mastodon.example');
    const user = userEvent.setup();

    expect(
      await screen.findByText('Nobody on this server matches. Look them up on the network above.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Look up on the network' }));

    expect(await screen.findByText('Carol')).toBeInTheDocument();
    const resolveCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === '/api/v1/search/resolve',
    );
    expect(JSON.parse(String(resolveCall?.[1]?.body))).toEqual({ q: '@carol@mastodon.example' });
    // The result links to the profile inside the app.
    expect(screen.getByRole('link', { name: /Carol/ })).toHaveAttribute(
      'href',
      '/@carol@mastodon.example',
    );

    await user.click(await screen.findByRole('button', { name: 'Follow Carol' }));
    expect(
      await screen.findByRole('button', { name: 'Cancel follow request to Carol' }),
    ).toHaveTextContent('Requested');
  });

  it('says so when the network has nothing at that address', async () => {
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /search/accounts': { body: [] },
      'POST /search/resolve': { body: null },
    });
    renderApp('/search?q=nobody%40nowhere.example');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Look up on the network' }));
    expect(
      await screen.findByText(
        'Nothing found at nobody@nowhere.example. Check the address and try again.',
      ),
    ).toBeInTheDocument();
  });

  it('opens remote profiles inside the app', async () => {
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /accounts/lookup/carol@mastodon.example': {
        body: { ...remote, followersCount: 1200, followingCount: 3, statusesCount: 1 },
      },
      'GET /accounts/relationships': { body: [relationship(remote.id)] },
      [`GET /accounts/${remote.id}/statuses`]: { body: [] },
      [`GET /accounts/${remote.id}/followers`]: { body: [] },
    });
    renderApp('/@carol@mastodon.example');
    expect(await screen.findByRole('heading', { name: 'Carol' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on the original server' })).toHaveAttribute(
      'href',
      'https://mastodon.example/@carol',
    );
    expect(screen.getByRole('button', { name: '1,200 followers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 post' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No posts yet.')).toBeInTheDocument());
  });
});
