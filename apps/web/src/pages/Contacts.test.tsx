import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, makeAccount } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

const relationship = (id: string, extra: object = {}) => ({
  id,
  following: true,
  requested: false,
  followedBy: true,
  blocking: false,
  blockedBy: false,
  muting: false,
  aspectIds: [],
  ...extra,
});

describe('contacts page', () => {
  it('lists contacts and narrows them by aspect', async () => {
    const jun = makeAccount({
      id: 'a1',
      username: 'jun',
      acct: 'jun@mastodon.example',
      displayName: 'Jun Park',
    });
    const ines = makeAccount({
      id: 'a2',
      username: 'ines',
      acct: 'ines@diaspora.example',
      displayName: 'Inês Costa',
    });
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /aspects': { body: [{ id: 'asp1', name: 'Family', memberCount: 1 }] },
      'GET /me/contacts': (_body, url) => ({
        body: String(url).includes('aspectId=asp1')
          ? [{ account: ines, relationship: relationship('a2', { aspectIds: ['asp1'] }) }]
          : [
              { account: jun, relationship: relationship('a1') },
              { account: ines, relationship: relationship('a2', { aspectIds: ['asp1'] }) },
            ],
      }),
    });
    renderApp('/contacts');
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Contacts' })).toBeInTheDocument();
    const list = within(await screen.findByRole('main'))
      .getAllByRole('list')
      .at(-1) as HTMLElement;
    await within(list).findByText('Jun Park');
    expect(within(list).getByText('Jun Park')).toBeInTheDocument();
    expect(within(list).getByText('Inês Costa')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Family' }));
    expect(
      await screen.findByRole('link', { name: 'Family', current: 'page' }),
    ).toBeInTheDocument();
    await screen.findByText('Inês Costa');
    expect(screen.queryByText('Jun Park')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('aspectId=asp1'))).toBe(true);
  });
});
