import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, bob, makeStatus } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

describe('report dialog', () => {
  it('reports a post with a category, more posts and a comment', async () => {
    const reported = makeStatus({ account: bob, content: '<p>Buy cheap pills</p>' });
    const other = makeStatus({ account: bob, content: '<p>More cheap pills</p>' });
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [reported] },
      [`GET /accounts/${bob.id}/statuses`]: { body: [reported, other] },
      'POST /reports': { status: 201, body: { id: 'r1' } },
    });
    renderApp('/');
    const user = userEvent.setup();
    const article = await screen.findByRole('article');

    await user.click(within(article).getByRole('button', { name: 'More actions' }));
    await user.click(within(article).getByRole('button', { name: 'Report @bob' }));

    const dialog = await screen.findByRole('dialog', { name: 'Report Bob' });
    // The post the report started from is already selected.
    expect(within(dialog).getByRole('checkbox', { name: /Buy cheap pills/ })).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: /Harassment/ }));
    await user.click(await within(dialog).findByRole('checkbox', { name: /More cheap pills/ }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Comment (optional)' }), 'Daily');
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));

    expect(
      await screen.findByRole('dialog', { name: 'Thanks for your report' }),
    ).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/v1/reports');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      accountId: bob.id,
      statusIds: [reported.id, other.id],
      category: 'harassment',
      comment: 'Daily',
    });

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes with Escape without sending anything', async () => {
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [makeStatus({ account: bob })] },
      [`GET /accounts/${bob.id}/statuses`]: { body: [] },
    });
    renderApp('/');
    const user = userEvent.setup();
    const article = await screen.findByRole('article');
    await user.click(within(article).getByRole('button', { name: 'More actions' }));
    await user.click(within(article).getByRole('button', { name: 'Report @bob' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/v1/reports')).toBe(false);
  });
});
