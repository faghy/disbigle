import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aliceUser, makeStatus } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

/** jsdom lays nothing out: pretend every block is as tall as `height`. */
function pretendHeight(height: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(height);
}

afterEach(() => vi.restoreAllMocks());

describe('long posts (issue #30)', () => {
  it('shortens a long post in the timeline, with a button to read it all', async () => {
    pretendHeight(1200);
    const status = makeStatus({ content: '<p>A very long story</p>' });
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [status] },
    });
    renderApp('/');
    const article = await screen.findByRole('article');
    const more = await within(article).findByRole('button', { name: 'Show all' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    const user = userEvent.setup();
    await user.click(more);
    expect(within(article).getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('leaves short posts alone', async () => {
    pretendHeight(120);
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [makeStatus({ content: '<p>Short</p>' })] },
    });
    renderApp('/');
    const article = await screen.findByRole('article');
    await waitFor(() => expect(within(article).getByText('Short')).toBeInTheDocument());
    expect(within(article).queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument();
  });
});

describe('replies on the home timeline (issue #30)', () => {
  it('lets the reader choose which replies to see', async () => {
    let homeReplies = 'following';
    const fetchMock = mockApi({
      'GET /me': () => ({ body: { ...aliceUser, homeReplies } }),
      'GET /instance': instance(),
      'GET /timelines/home': { body: [] },
      'PATCH /me/settings': (body) => {
        homeReplies = (body as { homeReplies: string }).homeReplies;
        return { body: { ...aliceUser, homeReplies } };
      },
    });
    renderApp('/');
    const choice = await screen.findByRole('combobox', { name: 'Replies' });
    expect(choice).toHaveValue('following');
    const user = userEvent.setup();
    await user.selectOptions(choice, 'none');
    await waitFor(() => expect(choice).toHaveValue('none'));
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/timelines/home')).length,
    ).toBeGreaterThan(1);
  });
});
