import type { Status } from '@disbigle/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, makeStatus } from '../test/fixtures.ts';
import { instance, type MockResponse, mockApi, renderApp } from '../test/utils.tsx';

/** A response the test releases by hand, to look at the UI while the request is in flight. */
function deferred() {
  let release: (value: MockResponse) => void = () => {};
  const promise = new Promise<MockResponse>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function renderHomeWith(status: Status, routes: Parameters<typeof mockApi>[0]) {
  mockApi({
    'GET /me': { body: aliceUser },
    'GET /instance': instance(),
    'GET /timelines/home': { body: [status] },
    ...routes,
  });
  renderApp('/');
  return screen.findByRole('article');
}

describe('status card', () => {
  it('likes optimistically, then shows the server count', async () => {
    const status = makeStatus({ likesCount: 2 });
    const response = deferred();
    const article = await renderHomeWith(status, {
      [`POST /statuses/${status.id}/like`]: () => response.promise,
    });
    const user = userEvent.setup();

    await user.click(within(article).getByRole('button', { name: 'Like' }));
    const pressed = within(article).getByRole('button', { name: 'Remove like' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    expect(pressed).toHaveTextContent('3');

    response.release({ body: { ...status, liked: true, likesCount: 7 } });
    await waitFor(() =>
      expect(within(article).getByRole('button', { name: 'Remove like' })).toHaveTextContent('7'),
    );
  });

  it('puts things back when the like fails', async () => {
    const status = makeStatus({ likesCount: 2 });
    const article = await renderHomeWith(status, {
      [`POST /statuses/${status.id}/like`]: {
        status: 500,
        body: { error: 'internal_error', message: 'boom' },
      },
    });
    const user = userEvent.setup();
    await user.click(within(article).getByRole('button', { name: 'Like' }));
    expect(await within(article).findByRole('alert')).toHaveTextContent('Something went wrong');
    const like = within(article).getByRole('button', { name: 'Like' });
    expect(like).toHaveAttribute('aria-pressed', 'false');
    expect(like).toHaveTextContent('2');
  });

  it('only allows resharing public posts', async () => {
    const status = makeStatus({ visibility: 'followers' });
    const article = await renderHomeWith(status, {});
    expect(
      within(article).getByRole('button', { name: "This post can't be reshared" }),
    ).toBeDisabled();
  });

  it('hides content behind a content warning', async () => {
    const status = makeStatus({ summary: 'Spoilers', content: '<p>The butler did it</p>' });
    const article = await renderHomeWith(status, {});
    const user = userEvent.setup();
    expect(within(article).getByText('The butler did it')).not.toBeVisible();
    await user.click(within(article).getByRole('button', { name: 'Show more' }));
    expect(within(article).getByText('The butler did it')).toBeVisible();
  });

  it('shows the reshare header and opens internal links in the app', async () => {
    const original = makeStatus({
      content: `<p>See <a href="${window.location.origin}/tags/cats" class="mention hashtag" rel="tag" target="_blank">#cats</a></p>`,
    });
    const reshare = makeStatus({ account: aliceUser.account, reblog: original, content: '' });
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [reshare] },
      'GET /timelines/tag/cats': { body: [] },
    });
    const { router } = renderApp('/');
    const article = await screen.findByRole('article');
    expect(within(article).getByText('Alice Liddell reshared')).toBeInTheDocument();
    await userEvent.setup().click(within(article).getByRole('link', { name: '#cats' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tags/cats'));
  });
});

describe('editing a post', () => {
  it('prefills the markdown source, saves and marks the post as edited', async () => {
    const own = makeStatus({
      account: aliceUser.account,
      content: '<p><strong>Hello</strong></p>',
      source: '**Hello**',
    });
    let saved: unknown;
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [own] },
      [`PUT /statuses/${own.id}`]: (body) => {
        saved = body;
        return {
          body: {
            ...own,
            content: '<p><strong>Hello</strong> again</p>',
            source: '**Hello** again',
            editedAt: new Date().toISOString(),
          },
        };
      },
    });
    renderApp('/');
    const user = userEvent.setup();
    const article = await screen.findByRole('article');
    await user.click(within(article).getByRole('button', { name: 'More actions' }));
    await user.click(within(article).getByRole('button', { name: 'Edit' }));

    const editor = within(article).getByRole('textbox', { name: 'Edit post' });
    expect(editor).toHaveValue('**Hello**');
    await user.type(editor, ' again');
    await user.click(within(article).getByRole('button', { name: 'Save' }));

    expect(await within(article).findByText('again', { exact: false })).toBeInTheDocument();
    expect(within(article).getByText('edited')).toBeInTheDocument();
    expect(saved).toEqual({ content: '**Hello** again', summary: '', sensitive: false });
  });
});
