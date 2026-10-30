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

    await user.click(within(article).getByRole('button', { name: 'Like, 2 likes' }));
    const pressed = within(article).getByRole('button', { name: 'Like, 3 likes' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    expect(pressed).toHaveTextContent('3');

    response.release({ body: { ...status, liked: true, likesCount: 7 } });
    await waitFor(() =>
      expect(within(article).getByRole('button', { name: 'Like, 7 likes' })).toHaveTextContent('7'),
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
    await user.click(within(article).getByRole('button', { name: 'Like, 2 likes' }));
    expect(await within(article).findByRole('alert')).toHaveTextContent('Something went wrong');
    const like = within(article).getByRole('button', { name: 'Like, 2 likes' });
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

  it('translates posts in another language and shows the original again', async () => {
    const status = makeStatus({ language: 'it', content: '<p>Ciao a tutti</p>' });
    let asked: unknown;
    const article = await renderHomeWith(status, {
      'GET /instance': { body: { ...instance().body, translation: true } },
      [`POST /statuses/${status.id}/translate`]: (body) => {
        asked = body;
        return {
          body: {
            content: '<p>Hello everyone</p>',
            summary: '',
            sourceLanguage: 'it',
            language: 'en',
            provider: 'Bergamot',
          },
        };
      },
    });
    const user = userEvent.setup();
    await user.click(within(article).getByRole('button', { name: 'Translate' }));
    expect(await within(article).findByText('Hello everyone')).toBeVisible();
    expect(asked).toEqual({ lang: 'en' });
    expect(within(article).getByText(/Translated from Italian/)).toBeVisible();
    expect(within(article).queryByText('Ciao a tutti')).toBeNull();

    await user.click(within(article).getByRole('button', { name: 'Show original' }));
    expect(within(article).getByText('Ciao a tutti')).toBeVisible();
    expect(within(article).getByRole('button', { name: 'Translate' })).toBeVisible();
  });

  it('offers no translation for posts in your language or without a translation service', async () => {
    const english = makeStatus({ language: 'en', content: '<p>Hello</p>' });
    const article = await renderHomeWith(english, {
      'GET /instance': { body: { ...instance().body, translation: true } },
    });
    expect(within(article).queryByRole('button', { name: 'Translate' })).toBeNull();
  });

  it('offers translation only from languages the server has models for', async () => {
    const portuguese = makeStatus({ language: 'pt', content: '<p>Olá a todos</p>' });
    const article = await renderHomeWith(portuguese, {
      'GET /instance': {
        body: {
          ...instance().body,
          translation: true,
          translationLanguages: { it: ['en', 'es'], en: ['it', 'es'] },
        },
      },
    });
    expect(within(article).getByText('Olá a todos')).toBeVisible();
    expect(within(article).queryByRole('button', { name: 'Translate' })).toBeNull();
  });

  it('says when a post cannot be translated', async () => {
    const status = makeStatus({ language: 'it', content: '<p>Ciao a tutti</p>' });
    const article = await renderHomeWith(status, {
      'GET /instance': { body: { ...instance().body, translation: true } },
      [`POST /statuses/${status.id}/translate`]: {
        status: 422,
        body: { error: 'translation_unavailable', message: 'down' },
      },
    });
    await userEvent.setup().click(within(article).getByRole('button', { name: 'Translate' }));
    expect(await within(article).findByRole('alert')).toHaveTextContent(
      "Translation isn't available for this post right now.",
    );
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
    // Attachments always go with an edit; an untouched poll is left out, so its votes stay.
    expect(saved).toEqual({
      content: '**Hello** again',
      summary: '',
      sensitive: false,
      mediaIds: [],
    });
  });

  it('removes an attachment', async () => {
    const image = (id: string, name: string) => ({
      id,
      type: 'image' as const,
      url: `https://disbigle.test/media/${name}`,
      previewUrl: null,
      description: name,
      width: 10,
      height: 10,
      blurhash: null,
    });
    const own = makeStatus({
      account: aliceUser.account,
      source: 'Two photos',
      media: [
        image('01a12800-0000-7000-8000-0000000000a1', 'sea.png'),
        image('01a12800-0000-7000-8000-0000000000a2', 'hill.png'),
      ],
    });
    let saved: { mediaIds?: string[] } = {};
    const article = await renderHomeWith(own, {
      [`PUT /statuses/${own.id}`]: (body) => {
        saved = body as typeof saved;
        return { body: { ...own, media: own.media.slice(1) } };
      },
    });
    const user = userEvent.setup();
    await user.click(within(article).getByRole('button', { name: 'More actions' }));
    await user.click(within(article).getByRole('button', { name: 'Edit' }));
    await user.click(within(article).getByRole('button', { name: 'Remove sea.png' }));
    await user.click(within(article).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved.mediaIds).toEqual(['01a12800-0000-7000-8000-0000000000a2']));
  });

  it('sends a changed poll and warns that votes are cleared', async () => {
    const own = makeStatus({
      account: aliceUser.account,
      source: 'Lunch?',
      poll: {
        id: '01a12800-0000-7000-8000-000000000011',
        expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
        expired: false,
        multiple: false,
        votesCount: 3,
        votersCount: 3,
        options: [
          { title: 'Pizza', votesCount: 2 },
          { title: 'Pasta', votesCount: 1 },
        ],
        voted: false,
        ownVotes: [],
      },
    });
    let saved: { poll?: unknown } = {};
    const article = await renderHomeWith(own, {
      [`PUT /statuses/${own.id}`]: (body) => {
        saved = body as typeof saved;
        return { body: own };
      },
    });
    const user = userEvent.setup();
    await user.click(within(article).getByRole('button', { name: 'More actions' }));
    await user.click(within(article).getByRole('button', { name: 'Edit' }));
    expect(within(article).getByText(/clears the votes/)).toBeInTheDocument();
    const second = within(article).getByRole('textbox', { name: 'Option 2' });
    await user.clear(second);
    await user.type(second, 'Salad');
    await user.click(within(article).getByRole('button', { name: 'Save' }));
    // Three hours left: the closest duration offered is six hours.
    await waitFor(() =>
      expect(saved.poll).toEqual({
        options: ['Pizza', 'Salad'],
        expiresIn: 21_600,
        multiple: false,
      }),
    );
  });
});

describe('card details', () => {
  it('shows who a reply answers, linking to the parent thread', async () => {
    const parentId = '01a12800-0000-7000-8000-0000000000e1';
    const reply = makeStatus({
      content: '<p>Thanks!</p>',
      inReplyToId: parentId,
      inReplyToAccountId: aliceUser.account.id,
      mentions: [{ id: aliceUser.account.id, username: 'alice', acct: 'alice', url: null }],
    });
    const article = await renderHomeWith(reply, {});
    const link = within(article).getByRole('link', { name: 'Replying to @alice' });
    expect(link).toHaveAttribute('href', `/@alice/${parentId}`);
  });

  it('falls back to a generic reply line when the parent author is unknown', async () => {
    const reply = makeStatus({
      inReplyToId: '01a12800-0000-7000-8000-0000000000e2',
      inReplyToAccountId: '01a12800-0000-7000-8000-0000000000e3',
    });
    const article = await renderHomeWith(reply, {});
    expect(within(article).getByRole('link', { name: 'Replying to a post' })).toBeInTheDocument();
  });

  it('names the parent author from the handle the server provides', async () => {
    const reply = makeStatus({
      inReplyToId: '01a12800-0000-7000-8000-0000000000e4',
      inReplyToAccountId: '01a12800-0000-7000-8000-0000000000e5',
      inReplyToAccountAcct: 'dora@remote.example',
    });
    const article = await renderHomeWith(reply, {});
    const link = within(article).getByRole('link', { name: 'Replying to @dora@remote.example' });
    expect(link).toHaveAttribute(
      'href',
      '/@dora@remote.example/01a12800-0000-7000-8000-0000000000e4',
    );
  });

  it('shows counts next to the actions and says them to screen readers', async () => {
    const status = makeStatus({ repliesCount: 4, reblogsCount: 1, likesCount: 0 });
    const article = await renderHomeWith(status, {});
    expect(within(article).getByRole('button', { name: 'Reply, 4 replies' })).toHaveTextContent(
      '4',
    );
    expect(within(article).getByRole('button', { name: 'Reshare, 1 reshare' })).toHaveTextContent(
      '1',
    );
    // Zero counts are hidden.
    const like = within(article).getByRole('button', { name: 'Like' });
    expect(like).toHaveTextContent('');
  });

  it('names the parent author when the parent post is already loaded', async () => {
    const parent = makeStatus({ account: aliceUser.account, content: '<p>Welcome!</p>' });
    const reply = makeStatus({
      content: '<p>Thanks</p>',
      inReplyToId: parent.id,
      inReplyToAccountId: aliceUser.account.id,
    });
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [reply, parent] },
    });
    renderApp('/');
    const [first] = await screen.findAllByRole('article');
    expect(
      within(first as HTMLElement).getByRole('link', { name: 'Replying to @alice' }),
    ).toBeInTheDocument();
  });
});
