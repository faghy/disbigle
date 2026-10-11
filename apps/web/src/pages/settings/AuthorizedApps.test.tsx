import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { groupScopes } from '../../api/apps.ts';
import { aliceUser } from '../../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../../test/utils.tsx';

const tusky = {
  id: '01a12800-0000-7000-8000-0000000000d1',
  name: 'Tusky',
  website: 'https://tusky.app/',
  scopes: ['read', 'write', 'follow', 'push'],
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  lastUsedAt: new Date(Date.now() - 60_000).toISOString(),
};
const reader = {
  id: '01a12800-0000-7000-8000-0000000000d2',
  name: 'Feed reader',
  website: 'javascript:alert(1)',
  scopes: ['read:statuses', 'read:accounts'],
  createdAt: new Date().toISOString(),
  lastUsedAt: null,
};

describe('groupScopes', () => {
  it('collapses granular scopes under their group', () => {
    expect(groupScopes(['write:statuses', 'read', 'read:accounts', 'push'])).toEqual([
      { name: 'read', full: true, parts: ['accounts'] },
      { name: 'write', full: false, parts: ['statuses'] },
      { name: 'push', full: true, parts: [] },
    ]);
  });
});

describe('authorized apps', () => {
  it('lists apps with readable permissions and revokes one after confirming', async () => {
    let list = [tusky, reader];
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /me/apps': () => ({ body: list }),
      [`DELETE /me/apps/${tusky.id}`]: () => {
        list = [reader];
        return { body: { status: 'ok' } };
      },
    });
    renderApp('/settings/apps');
    const user = userEvent.setup();

    const apps = await screen.findByRole('list', { name: 'Authorized apps' });
    const [first, second] = within(apps)
      .getAllByRole('listitem', { name: undefined })
      .filter((item) => item.parentElement === apps);
    expect(first).toHaveTextContent('Tusky');
    expect(within(first as HTMLElement).getByRole('link', { name: 'tusky.app' })).toHaveAttribute(
      'href',
      'https://tusky.app/',
    );
    const permissions = within(first as HTMLElement).getByRole('list', { name: 'Permissions' });
    expect(permissions).toHaveTextContent('ReadWriteFollowPush notifications');
    // Granular scopes are collapsed; unsafe websites are not linked.
    expect(second).toHaveTextContent('Read (partial)');
    expect(within(second as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
    expect(second).toHaveTextContent('never used');

    await user.click(screen.getByRole('button', { name: 'Revoke access for Tusky' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Revoke access for Tusky?' });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => expect(screen.queryByText('Tusky')).not.toBeInTheDocument());
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => init?.method === 'DELETE' && String(url) === `/api/v1/me/apps/${tusky.id}`,
      ),
    ).toBe(true);
  });

  it('explains how to use apps when there are none', async () => {
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /me/apps': { body: [] },
    });
    renderApp('/settings/apps');
    expect(await screen.findByText('No apps have access to your account.')).toBeInTheDocument();
    expect(screen.getByText(/Tusky, Ivory or Elk/)).toHaveTextContent('disbigle.test');
  });
});
