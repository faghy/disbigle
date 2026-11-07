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
});
