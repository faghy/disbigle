import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser } from '../../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../../test/utils.tsx';

describe('muted words', () => {
  it('mutes a phrase in chosen places for a week, lists it and unmutes it', async () => {
    let list: unknown[] = [];
    let sent: unknown;
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /filters': () => ({ body: list }),
      'POST /filters': (body) => {
        sent = body;
        const created = {
          id: '01a12800-0000-7000-8000-0000000000f1',
          ...(body as object),
          expiresAt: new Date(Date.now() + 604_800_000).toISOString(),
        };
        list = [created];
        return { status: 201, body: created };
      },
      'DELETE /filters/01a12800-0000-7000-8000-0000000000f1': () => {
        list = [];
        return { body: { status: 'ok' } };
      },
    });
    renderApp('/settings/muted-words');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Mute' }));
    expect(screen.getByRole('textbox', { name: 'Word or phrase' })).toHaveAccessibleDescription(
      'This field is required.',
    );

    await user.type(screen.getByRole('textbox', { name: 'Word or phrase' }), 'spoiler');
    await user.click(screen.getByRole('checkbox', { name: 'Whole word only' }));
    await user.click(screen.getByRole('checkbox', { name: 'Notifications' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'For' }), '1 week');
    await user.click(screen.getByRole('button', { name: 'Mute' }));

    const words = await screen.findByRole('list', { name: 'Your muted words' });
    expect(within(words).getByText('“spoiler”')).toBeInTheDocument();
    expect(sent).toEqual({
      phrase: 'spoiler',
      wholeWord: false,
      contexts: ['home', 'public', 'thread'],
      expiresIn: 604_800,
    });

    await user.click(screen.getByRole('button', { name: 'Unmute “spoiler”' }));
    expect(await screen.findByText('You have not muted any words.')).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true),
    );
  });
});
