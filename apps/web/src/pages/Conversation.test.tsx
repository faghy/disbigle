import type { ConversationDetail } from '@disbigle/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, bob, makeStatus } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';
import { withoutLeadingMentions } from './Conversation.tsx';

const mention = (name: string) =>
  `<span class="h-card"><a href="https://disbigle.test/@${name}" class="u-url mention">@<span>${name}</span></a></span>`;

describe('a conversation as a chat', () => {
  it('shows bubbles without the addressing mentions, marks it read and says it was seen', async () => {
    const fromBob = makeStatus({
      id: '01900000-0000-7000-8000-000000000001',
      account: bob,
      visibility: 'direct',
      content: `<p>${mention('alice')} Ciao Alice!</p>`,
    });
    const mine = makeStatus({
      id: '01900000-0000-7000-8000-000000000002',
      account: aliceUser.account,
      visibility: 'direct',
      content: `<p>${mention('bob')} Ciao Bob</p>`,
    });
    const detail: ConversationDetail = {
      id: fromBob.id,
      accounts: [bob],
      messages: [mine, fromBob],
      seen: [{ accountId: bob.id, lastReadId: mine.id }],
    };
    let read = false;
    let sent: Record<string, unknown> | undefined;
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      [`GET /timelines/conversations/${fromBob.id}`]: { body: detail },
      [`POST /timelines/conversations/${fromBob.id}/read`]: () => {
        read = true;
        return { body: { lastReadId: mine.id } };
      },
      'POST /statuses': (body) => {
        sent = body as Record<string, unknown>;
        return {
          status: 201,
          body: makeStatus({ ...(body as object), account: aliceUser.account }),
        };
      },
    });
    renderApp(`/messages/${fromBob.id}`);
    const user = userEvent.setup();
    // The bubble holds only the text: the mention addressing it is gone.
    expect((await screen.findByText('Ciao Alice!')).textContent).toBe('Ciao Alice!');
    expect(screen.getByText('Ciao Bob').textContent).toBe('Ciao Bob');
    expect(screen.getByText('Seen')).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('Bob')).toBeInTheDocument();
    await waitFor(() => expect(read).toBe(true));

    const input = screen.getByRole('textbox', { name: 'Write a message' });
    await user.type(input, 'Come stai?{Enter}');
    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toMatchObject({
      content: '@bob Come stai?',
      visibility: 'direct',
      inReplyToId: mine.id,
    });
  });

  it('leaves mentions in the middle of a message alone', () => {
    expect(withoutLeadingMentions(`<p>${mention('bob')} hai visto ${mention('carol')}?</p>`)).toBe(
      `<p>hai visto ${mention('carol')}?</p>`,
    );
    expect(withoutLeadingMentions('<p>niente</p>')).toBe('<p>niente</p>');
  });
});
