import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, bob, makeAccount, makeStatus } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

const carol = makeAccount({
  username: 'carol',
  acct: 'carol@diaspo.example',
  displayName: 'Carol',
  local: false,
});

describe('messages', () => {
  it('lists conversations with participants and the last message', async () => {
    const last = makeStatus({
      account: aliceUser.account,
      visibility: 'direct',
      content: '<p>See you tomorrow</p>',
    });
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/conversations': {
        body: [{ id: last.id, accounts: [bob, carol], lastStatus: last }],
      },
    });
    renderApp('/messages');
    const list = await screen.findByRole('list', { name: 'Messages' });
    const row = within(list).getByRole('link');
    expect(row).toHaveTextContent('Bob, Carol');
    expect(row).toHaveTextContent('You: See you tomorrow');
    expect(row).toHaveAttribute('href', `/@alice/${last.id}`);
    expect(screen.getAllByRole('link', { name: 'Messages' })[0]).toHaveAttribute(
      'href',
      '/messages',
    );
  });

  it('writes a direct message to people picked from search', async () => {
    let sent: Record<string, unknown> | undefined;
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/conversations': { body: [] },
      'GET /search/accounts': (_body, url) => ({
        body: (url.searchParams.get('q') ?? '').startsWith('car') ? [carol] : [bob],
      }),
      'POST /statuses': (body) => {
        sent = body as Record<string, unknown>;
        return {
          status: 201,
          body: makeStatus({ ...(body as object), account: aliceUser.account }),
        };
      },
    });
    const { router } = renderApp('/messages');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'New message' }));
    expect(screen.getByRole('button', { name: /Share with/ })).toHaveTextContent('Direct');

    await user.type(screen.getByRole('searchbox', { name: 'To' }), 'car');
    await user.click(await screen.findByRole('button', { name: /Carol/ }));
    expect(screen.getByRole('textbox', { name: 'New post' })).toHaveValue('@carol@diaspo.example ');

    await user.type(screen.getByRole('searchbox', { name: 'To' }), 'bo');
    await user.click(await screen.findByRole('button', { name: /Bob/ }));
    await user.type(screen.getByRole('textbox', { name: 'New post' }), 'Dinner on Friday?');
    expect(screen.getByRole('textbox', { name: 'New post' })).toHaveValue(
      '@carol@diaspo.example @bob Dinner on Friday?',
    );

    // Removing a recipient also removes the mention.
    await user.click(screen.getByRole('button', { name: 'Remove @bob' }));
    expect(screen.getByRole('textbox', { name: 'New post' })).toHaveValue(
      '@carol@diaspo.example Dinner on Friday?',
    );

    await user.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toMatchObject({
      visibility: 'direct',
      content: '@carol@diaspo.example Dinner on Friday?',
    });
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/@alice\//));
  });

  it('starts a message to the person whose profile asked for it', async () => {
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/conversations': { body: [] },
      'GET /accounts/lookup/carol@diaspo.example': { body: carol },
    });
    renderApp('/messages?to=carol@diaspo.example');
    // Carol is already a recipient, and mentioned at the start of the message.
    expect(
      await screen.findByRole('button', { name: 'Remove @carol@diaspo.example' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'New post' })).toHaveValue('@carol@diaspo.example ');
    expect(screen.getByRole('button', { name: /Share with/ })).toHaveTextContent('Direct');
  });
});
