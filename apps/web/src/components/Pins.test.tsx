import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, makeStatus, relationship } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

describe('pinned posts', () => {
  it('pins your own public post from the More menu', async () => {
    const own = makeStatus({ account: aliceUser.account, content: '<p>Read this first</p>' });
    let pinnedIds: string[] = [];
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [own] },
      [`GET /accounts/${aliceUser.account.id}/statuses`]: (_body, url) => ({
        body:
          url.searchParams.get('pinned') === 'true'
            ? pinnedIds.map((id) => ({ ...own, id, pinned: true }))
            : [own],
      }),
      [`POST /statuses/${own.id}/pin`]: () => {
        pinnedIds = [own.id];
        return { body: own };
      },
    });
    renderApp('/');
    const user = userEvent.setup();
    const article = await screen.findByRole('article');
    await user.click(within(article).getByRole('button', { name: 'More actions' }));
    await user.click(await within(article).findByRole('button', { name: 'Pin to profile' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === `/api/v1/statuses/${own.id}/pin`),
      ).toBe(true),
    );
    // Opening the menu again offers to unpin.
    await user.click(within(article).getByRole('button', { name: 'More actions' }));
    expect(
      await within(article).findByRole('button', { name: 'Unpin from profile' }),
    ).toBeInTheDocument();
  });

  it('explains the pin limit', async () => {
    const own = makeStatus({ account: aliceUser.account });
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [own] },
      [`GET /accounts/${aliceUser.account.id}/statuses`]: { body: [] },
      [`POST /statuses/${own.id}/pin`]: {
        status: 400,
        body: { error: 'bad_request', message: 'You can pin up to 5 posts' },
      },
    });
    renderApp('/');
    const user = userEvent.setup();
    const article = await screen.findByRole('article');
    await user.click(within(article).getByRole('button', { name: 'More actions' }));
    await user.click(await within(article).findByRole('button', { name: 'Pin to profile' }));
    expect(await within(article).findByRole('alert')).toHaveTextContent(
      'You can pin up to 5 public or unlisted posts.',
    );
  });

  it('does not offer pinning for followers-only posts', async () => {
    const own = makeStatus({ account: aliceUser.account, visibility: 'followers' });
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [own] },
    });
    renderApp('/');
    const user = userEvent.setup();
    const article = await screen.findByRole('article');
    await user.click(within(article).getByRole('button', { name: 'More actions' }));
    expect(
      within(article).queryByRole('button', { name: 'Pin to profile' }),
    ).not.toBeInTheDocument();
  });

  it('shows pinned posts above the posts on a profile', async () => {
    const bobAccount = {
      ...aliceUser.account,
      id: '01a12800-0000-7000-8000-0000000000c1',
      username: 'bobby',
      acct: 'bobby',
      displayName: 'Bobby',
    };
    const pinned = makeStatus({ account: bobAccount, content: '<p>My rules</p>' });
    const recent = makeStatus({ account: bobAccount, content: '<p>Just now</p>' });
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /accounts/lookup/bobby': { body: bobAccount },
      'GET /accounts/relationships': { body: [relationship(bobAccount.id)] },
      [`GET /accounts/${bobAccount.id}/statuses`]: (_body, url) => ({
        body: url.searchParams.get('pinned') === 'true' ? [{ ...pinned, pinned: true }] : [recent],
      }),
    });
    renderApp('/@bobby');
    const section = await screen.findByRole('region', { name: 'Pinned posts' });
    expect(within(section).getByText('My rules')).toBeInTheDocument();
    expect(within(section).getByText('Pinned')).toBeInTheDocument();
    expect(await screen.findByText('Just now')).toBeInTheDocument();
  });
});
