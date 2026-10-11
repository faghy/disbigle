import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser } from '../../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../../test/utils.tsx';

const existing = {
  id: '01a12800-0000-7000-8000-0000000000a1',
  code: 'oldcode',
  url: 'http://localhost:3000/register?invite=oldcode',
  maxUses: 5,
  uses: 2,
  expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
};

describe('invitation links', () => {
  it('creates a link, copies it and deletes an old one', async () => {
    let created: unknown;
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance('invite'),
      'GET /invites': { body: [existing] },
      'POST /invites': (body) => {
        created = body;
        return {
          status: 201,
          body: {
            ...existing,
            id: '01a12800-0000-7000-8000-0000000000a2',
            code: 'newcode',
            url: 'http://localhost:3000/register?invite=newcode',
            maxUses: null,
            uses: 0,
            expiresAt: null,
          },
        };
      },
      [`DELETE /invites/${existing.id}`]: { body: { status: 'ok' } },
    });
    renderApp('/settings/invites');
    const user = userEvent.setup();

    expect(await screen.findByText('Used 2 of 5 times')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Can be used'), 'Any number of times');
    await user.selectOptions(screen.getByLabelText('Expires after'), 'Never');
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(
      await screen.findByDisplayValue('http://localhost:3000/register?invite=newcode'),
    ).toBeInTheDocument();
    expect(created).toEqual({ maxUses: null, expiresIn: null });
    expect(screen.getByText('Used 0 times, no limit')).toBeInTheDocument();
    expect(screen.getByText('Never expires')).toBeInTheDocument();

    const [first] = screen.getAllByRole('button', { name: 'Copy link' });
    await user.click(first as HTMLElement);
    // user-event provides the clipboard in tests.
    expect(await navigator.clipboard.readText()).toBe(
      'http://localhost:3000/register?invite=newcode',
    );
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete invitation oldcode' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByDisplayValue(existing.url)).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });
});
