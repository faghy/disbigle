import type { HiddenTag } from '@disbigle/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, bob, makeStatus } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

const called = (fetchMock: ReturnType<typeof mockApi>, method: string, path: string) =>
  fetchMock.mock.calls.some(
    ([url, init]) => String(url) === `/api/v1${path}` && (init?.method ?? 'GET') === method,
  );

describe('hiding posts and hashtags', () => {
  it('hides a post, says so in its place and can undo it', async () => {
    const status = makeStatus({ content: '<p>Noioso</p>' });
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [status] },
      [`POST /statuses/${status.id}/hide`]: { body: { status: 'ok' } },
      [`POST /statuses/${status.id}/unhide`]: { body: { status: 'ok' } },
    });
    renderApp('/');
    const user = userEvent.setup();
    const article = await screen.findByRole('article');
    await user.click(within(article).getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('button', { name: 'Hide this post' }));
    expect(await screen.findByText(/Post hidden/)).toBeInTheDocument();
    expect(screen.queryByText('Noioso')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Noioso')).toBeInTheDocument();
    expect(called(fetchMock, 'POST', `/statuses/${status.id}/unhide`)).toBe(true);
  });

  it("hides one person's hashtag from a post of theirs", async () => {
    const status = makeStatus({
      account: bob,
      content: '<p>Partita #calcio</p>',
      tags: [{ name: 'calcio' }],
    });
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [status] },
      'POST /hidden_tags': (body) => {
        expect(body).toEqual({ name: 'calcio', accountId: bob.id });
        return { status: 201, body: { id: 'h1', name: 'calcio', account: bob } };
      },
    });
    renderApp('/');
    const user = userEvent.setup();
    const article = await screen.findByRole('article');
    await user.click(within(article).getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('button', { name: 'Hide #calcio from Bob' }));
    expect(
      await screen.findByText("You won't see Bob's posts with #calcio in your timelines."),
    ).toBeInTheDocument();
    expect(called(fetchMock, 'POST', '/hidden_tags')).toBe(true);
  });

  it('lists hidden hashtags next to the followed ones, each to show again', async () => {
    const hidden: HiddenTag[] = [
      { id: 'h1', name: 'politica', account: null },
      { id: 'h2', name: 'calcio', account: bob },
    ];
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /aspects': { body: [] },
      'GET /tags/followed': { body: ['jazz'] },
      'GET /hidden_tags': () => ({ body: hidden }),
      'DELETE /hidden_tags/h2': () => {
        hidden.pop();
        return { body: { status: 'ok' } };
      },
    });
    renderApp('/');
    const user = userEvent.setup();
    const [list] = await screen.findAllByRole('heading', { name: 'Hidden hashtags' });
    expect(list).toBeInTheDocument();
    const [showAgain] = await screen.findAllByRole('button', {
      name: `Show #calcio from @${bob.acct} again`,
    });
    if (!showAgain) throw new Error('no button');
    await user.click(showAgain);
    await waitFor(() => expect(called(fetchMock, 'DELETE', '/hidden_tags/h2')).toBe(true));
    await waitFor(() =>
      expect(
        screen.queryAllByRole('button', { name: `Show #calcio from @${bob.acct} again` }),
      ).toHaveLength(0),
    );
  });
});
