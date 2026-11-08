import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cardLinkOf,
  createPost,
  editPost,
  freshCard,
  getStatus,
  LocalMediaStorage,
  linkCard,
  listPostsWithoutCard,
  markNoCard,
  parsePageInfo,
  previewForUrl,
  registerUser,
  savePostCard,
} from '../src/index.ts';
import { uniqueUser, useTestContext } from './helpers.ts';

const base = useTestContext();
let dir = '';
let storage: LocalMediaStorage;
const ctx = () => ({ ...base(), storage });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'disbigle-cards-'));
  storage = new LocalMediaStorage(dir);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('link previews: reading pages', () => {
  it('picks the first real link of a post', () => {
    const mention =
      '<span class="h-card"><a href="https://disbigle.com/@bob" class="u-url mention">@bob</a></span>';
    const tag = '<a href="https://disbigle.com/tags/x" class="mention hashtag" rel="tag">#x</a>';
    expect(
      cardLinkOf(
        `<p>${mention} ${tag} <a href="https://youtu.be/abcdefghijk">v</a> <a href="https://disbigle.com/it/2026/x?a=1&amp;b=2#top">art</a></p>`,
      ),
    ).toBe('https://disbigle.com/it/2026/x?a=1&b=2');
    expect(cardLinkOf(`<p>${mention} niente</p>`)).toBeNull();
    expect(cardLinkOf('<p><a href="mailto:x@y.z">x</a></p>')).toBeNull();
  });

  it('reads Open Graph tags, with fallbacks', () => {
    const page = `<html><head><title>Old title</title>
      <meta property="og:title" content="Nascondi post &amp; hashtag">
      <meta name="description" content="Plain description">
      <meta property="og:site_name" content='Disbigle'>
      <meta content="/media/a.png" property="og:image">
      </head></html>`;
    expect(parsePageInfo(page, 'https://disbigle.com/it/2026/x')).toEqual({
      title: 'Nascondi post & hashtag',
      description: 'Plain description',
      siteName: 'Disbigle',
      image: 'https://disbigle.com/media/a.png',
    });
    expect(parsePageInfo('<title> Solo titolo </title>', 'https://x.example/')).toEqual({
      title: 'Solo titolo',
      description: '',
      siteName: '',
      image: null,
    });
    expect(parsePageInfo('<p>no title</p>', 'https://x.example/')).toBeNull();
  });
});

describe('link previews: on posts', () => {
  it('stores the preview with its image and shows it on every post with that link', async () => {
    const { actorId } = await registerUser(base(), uniqueUser());
    const post = await createPost(base(), actorId, {
      content: 'Leggete https://example.org/articolo',
    });
    const plain = await createPost(base(), actorId, { content: 'Niente link' });
    const waiting = await listPostsWithoutCard(base(), 50);
    expect(waiting.map((p) => p.id)).toEqual(expect.arrayContaining([post.id, plain.id]));
    await markNoCard(base(), plain.id);

    const image = await sharp({
      create: { width: 1200, height: 630, channels: 3, background: '#cf3200' },
    })
      .png()
      .toBuffer();
    const url = cardLinkOf((await getStatus(base(), actorId, post.id)).content);
    expect(url).toBe('https://example.org/articolo');
    await savePostCard(
      ctx(),
      post.id,
      url as string,
      { title: 'Un articolo', description: 'Di prova', siteName: '', image: 'x' },
      image,
    );
    const shown = await getStatus(base(), actorId, post.id);
    expect(shown.card).toMatchObject({
      url: 'https://example.org/articolo',
      title: 'Un articolo',
      siteName: 'example.org',
      width: 640,
      height: 336,
    });
    expect(shown.card?.image).toMatch(/\/media\/.+card-.+\.webp$/);
    expect((await getStatus(base(), actorId, plain.id)).card).toBeNull();

    // Another post with the same link reuses the stored preview.
    const again = await createPost(base(), actorId, { content: 'https://example.org/articolo' });
    const known = await freshCard(base(), 'https://example.org/articolo');
    expect(known).not.toBeNull();
    await linkCard(base(), again.id, known?.id ?? null);
    expect((await getStatus(base(), actorId, again.id)).card?.title).toBe('Un articolo');

    // Editing a post looks at its link again.
    await editPost(base(), actorId, post.id, { content: 'Cambiato https://example.org/altro' });
    expect((await getStatus(base(), actorId, post.id)).card).toBeNull();
    expect((await listPostsWithoutCard(base(), 50)).map((p) => p.id)).toContain(post.id);
  });

  it('reads a page while writing, and gives the post its preview at once', async () => {
    const { actorId } = await registerUser(base(), uniqueUser());
    const page =
      '<head><meta property="og:title" content=""><meta property="og:site_name" content="Societas"></head>';
    const fetched: string[] = [];
    const card = await previewForUrl(ctx(), 'https://pod.example/u/anna', async (url) => {
      fetched.push(url);
      return { data: Buffer.from(page), type: 'text/html; charset=utf-8' };
    });
    // An empty og:title falls back to the site name.
    expect(card).toMatchObject({ title: 'Societas', url: 'https://pod.example/u/anna' });
    // Asked again: the stored preview, no new fetch.
    await previewForUrl(ctx(), 'https://pod.example/u/anna', async () => {
      throw new Error('should not fetch');
    });
    expect(fetched).toEqual(['https://pod.example/u/anna']);

    const post = await createPost(base(), actorId, {
      content: 'Guarda https://pod.example/u/anna',
    });
    expect(post.card).toMatchObject({ title: 'Societas' });
  });
});
