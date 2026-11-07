import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser } from '../../test/fixtures.ts';
import { instance, mockApi, renderApp, signedOut } from '../../test/utils.tsx';

describe('bringing an account here', () => {
  it('signs up with the old address, only after reading the page about moving', async () => {
    const fetchMock = mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'POST /auth/register': { status: 201, body: { status: 'ok', user: aliceUser } },
    });
    const { router } = renderApp('/register?move=1');
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Bring your account' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your current account'), '@anna@mastodon.example');
    await user.type(screen.getByLabelText('Your new name here'), 'alice');
    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    const [rules, read] = screen.getAllByRole('checkbox');
    await user.click(rules as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Read the page about moving first')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'the page about moving an account' })).toHaveAttribute(
      'href',
      'https://disbigle.com/bring-your-account',
    );

    await user.click(read as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/move'));
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/register'));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      username: 'alice',
      moveFrom: 'anna@mastodon.example',
      moveAgreement: true,
    });
  });

  it('links the old account and points to its move page', async () => {
    let sent: unknown;
    let me = { ...aliceUser, moveFrom: 'anna@mastodon.example' };
    mockApi({
      'GET /me': () => ({ body: me }),
      'GET /instance': instance(),
      'POST /me/migration/aliases': (body) => {
        sent = body;
        me = { ...me, aliases: ['anna@mastodon.example'] };
        return { body: { aliases: ['https://mastodon.example/users/anna'] } };
      },
    });
    renderApp('/settings/move');
    const user = userEvent.setup();
    const field = await screen.findByLabelText('Your current account');
    expect(field).toHaveValue('anna@mastodon.example');
    expect(screen.getByText('Link your old account first.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(sent).toEqual({ accounts: ['anna@mastodon.example'] }));
    const linked = await screen.findByRole('list', { name: 'Linked accounts' });
    expect(within(linked).getByText('anna@mastodon.example')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open the move page on mastodon.example' }),
    ).toHaveAttribute('href', 'https://mastodon.example/settings/migration');
  });

  it('imports the list of people you follow from an exported file', async () => {
    let sent: { kind?: string; text?: string } = {};
    let imports: unknown[] = [];
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /me/migration/imports': () => ({ body: imports }),
      'POST /me/migration/imports': (body) => {
        sent = body as typeof sent;
        imports = [
          {
            id: 'i1',
            kind: 'following',
            total: 2,
            done: 1,
            failedCount: 1,
            failed: ['nobody@nowhere.example'],
            createdAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        ];
        return { status: 201, body: imports[0] };
      },
    });
    renderApp('/settings/move');
    const user = userEvent.setup();
    const csv = new File(
      ['Account address,Show boosts\nbob@disbigle.test,true\n'],
      'following_accounts.csv',
      {
        type: 'text/csv',
      },
    );
    await user.upload(await screen.findByLabelText('File (CSV)'), csv);
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(sent.kind).toBe('following'));
    expect(sent.text).toContain('bob@disbigle.test');
    const list = await screen.findByRole('list', { name: 'Imports' });
    expect(within(list).getByText(/1 done, 1 not found/)).toBeInTheDocument();
  });

  it('reads a diaspora* export in the browser and sends only what is needed', async () => {
    let sent: Record<string, unknown> = {};
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /me/migration/imports': { body: [] },
      'POST /me/migration/diaspora': (body) => {
        sent = body as Record<string, unknown>;
        return { status: 201, body: { aspects: 1, tags: 1, imports: [] } };
      },
    });
    renderApp('/settings/move');
    const user = userEvent.setup();
    const archive = {
      version: '2.0',
      user: {
        username: 'anna',
        private_key: 'SECRET KEY',
        profile: {
          entity_type: 'profile',
          entity_data: { first_name: 'Anna', last_name: 'Rossi', bio: 'Ciao' },
        },
        contact_groups: [{ name: 'Amici' }],
        contacts: [
          { account_id: 'bob@pod.example', following: true, contact_groups_membership: ['Amici'] },
          { account_id: 'eve@pod.example', following: false, contact_groups_membership: [] },
        ],
        followed_tags: ['fotografia'],
        blocks: ['troll@pod.example'],
      },
    };
    await user.upload(
      await screen.findByLabelText('diaspora* export (.json.gz)'),
      new File([JSON.stringify(archive)], 'export.json', { type: 'application/json' }),
    );
    expect(
      await screen.findByText('Found: 1 contacts, 1 aspects, 1 hashtags, 1 blocked people.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import from diaspora*' }));
    await waitFor(() => expect(sent.aspects).toEqual(['Amici']));
    expect(sent).toEqual({
      aspects: ['Amici'],
      contacts: [{ address: 'bob@pod.example', aspects: ['Amici'] }],
      tags: ['fotografia'],
      blocks: ['troll@pod.example'],
      displayName: 'Anna Rossi',
      bio: 'Ciao',
    });
    expect(JSON.stringify(sent)).not.toContain('SECRET');
  });
});
