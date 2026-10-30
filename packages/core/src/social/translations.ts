import { createHash } from 'node:crypto';
import { schema } from '@disbigle/db';
import type { Translation } from '@disbigle/shared';
import { and, eq } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { sanitizeRemoteHtml } from './content.ts';
import { baseLanguage, guessLanguage, loadLanguageDetector } from './language.ts';
import { getVisiblePost } from './posts.ts';

const { postTranslations, posts } = schema;

/** How long the list of languages of the translation service is kept. */
const LANGUAGES_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** Links, mentions and hashtags: kept as they are, not given to the translator. */
const UNTRANSLATED =
  /<a\b[^>]*>[\s\S]*?<\/a>|(?<![\w/@])@[\w.-]+(?:@[\w.-]+)?|(?<![\w/&#])#[\p{L}\p{N}_]+/giu;
const PLACEHOLDER = /<span data-k="(\d+)">[^<]*<\/span>/g;

let languagesCache: { url: string; at: number; targets: Map<string, Set<string>> } | null = null;

/** Whether this server can translate posts (a translation service is configured). */
export function translationEnabled(ctx: CoreContext): boolean {
  return Boolean(ctx.config.TRANSLATION_URL);
}

function unavailable(message = 'The translation service is not available'): DomainError {
  return new DomainError('translation_unavailable', message);
}

async function callService(ctx: CoreContext, path: string, body?: unknown): Promise<Response> {
  const base = ctx.config.TRANSLATION_URL;
  if (!base) throw unavailable('Translation is not enabled on this server');
  const response = await fetch(new URL(path, `${base.replace(/\/+$/, '')}/`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response?.ok) {
    if (response) console.error(`translation: ${path} answered ${response.status}`);
    throw unavailable();
  }
  return response;
}

/** Source language → languages it can be translated to, as the service reports them. */
export async function translationLanguages(ctx: CoreContext): Promise<Map<string, Set<string>>> {
  const url = ctx.config.TRANSLATION_URL;
  if (!url) return new Map();
  if (languagesCache?.url === url && Date.now() - languagesCache.at < LANGUAGES_TTL_MS) {
    return languagesCache.targets;
  }
  const list = (await (await callService(ctx, 'languages')).json()) as {
    code: string;
    targets?: string[];
  }[];
  const targets = new Map(list.map((l) => [l.code, new Set(l.targets ?? [])]));
  languagesCache = { url, at: Date.now(), targets };
  return targets;
}

/** Replaces what must not be translated with numbered placeholders the translator keeps. */
export function protectForTranslation(html: string): { html: string; kept: string[] } {
  const kept: string[] = [];
  const protectedHtml = html.replace(
    UNTRANSLATED,
    (match) => `<span data-k="${kept.push(match) - 1}">x</span>`,
  );
  return { html: protectedHtml, kept };
}

/** Puts back what `protectForTranslation` took out; anything the translator lost goes at the end. */
export function restoreAfterTranslation(html: string, kept: string[]): string {
  const restored = new Set<number>();
  const result = html.replace(PLACEHOLDER, (_, index: string) => {
    const i = Number(index);
    const original = kept[i];
    if (original === undefined || restored.has(i)) return '';
    restored.add(i);
    return original;
  });
  const lost = kept.filter((_, i) => !restored.has(i));
  return lost.length ? `${result} ${lost.join(' ')}` : result;
}

const escapeText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const unescapeText = (text: string) =>
  text
    .replace(/<[^>]*>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');

const hashOf = (post: { contentHtml: string; summary: string }) =>
  createHash('sha256').update(`${post.contentHtml}\0${post.summary}`).digest('hex').slice(0, 32);

/**
 * A post the viewer can see, translated to `targetLanguage` by the translation service.
 * Translations are kept, so each post goes to the service once per language (and again
 * after an edit).
 */
export async function translatePost(
  ctx: CoreContext,
  viewerActorId: string | null,
  postId: string,
  targetLanguage: string,
): Promise<Translation> {
  const target = baseLanguage(targetLanguage);
  if (!target) throw new DomainError('validation_failed', 'Unknown language');
  let post = await getVisiblePost(ctx, viewerActorId, postId);
  // A reshare is translated as the post it shares.
  if (post.reblogOfId) post = await getVisiblePost(ctx, viewerActorId, post.reblogOfId);
  if (!post.contentHtml.trim() && !post.summary.trim()) throw unavailable('Nothing to translate');

  const sourceHash = hashOf(post);
  const [cached] = await ctx.db
    .select()
    .from(postTranslations)
    .where(and(eq(postTranslations.postId, post.id), eq(postTranslations.language, target)));
  if (cached?.sourceHash === sourceHash) {
    return {
      content: cached.contentHtml,
      summary: cached.summary,
      sourceLanguage: cached.sourceLanguage,
      language: target,
      provider: cached.provider,
    };
  }

  await loadLanguageDetector();
  const known = baseLanguage(post.language) ?? guessLanguage(post.contentHtml, post.summary);
  if (known === target) throw unavailable('The post is already in this language');
  const languages = await translationLanguages(ctx);
  if (known && !languages.get(known)?.has(target)) {
    throw unavailable(`Translation from ${known} to ${target} is not available`);
  }

  const { html, kept } = protectForTranslation(post.contentHtml);
  const response = await callService(ctx, 'translate', {
    q: [html, escapeText(post.summary)],
    source: known ?? 'auto',
    target,
    format: 'html',
  });
  const body = (await response.json()) as {
    translatedText?: string[];
    detectedLanguage?: { language?: string };
  };
  const [content, summary] = body.translatedText ?? [];
  if (typeof content !== 'string' || typeof summary !== 'string') throw unavailable();
  const sourceLanguage = known ?? baseLanguage(body.detectedLanguage?.language) ?? 'und';
  if (sourceLanguage === target) throw unavailable('The post is already in this language');

  const translation = {
    content: sanitizeRemoteHtml(restoreAfterTranslation(content, kept)),
    summary: post.summary ? unescapeText(summary) : '',
    sourceLanguage,
    language: target,
    provider: response.headers.get('x-translation-provider') ?? 'LibreTranslate',
  };
  await ctx.db
    .insert(postTranslations)
    .values({
      postId: post.id,
      language: target,
      sourceHash,
      sourceLanguage,
      contentHtml: translation.content,
      summary: translation.summary,
      provider: translation.provider,
    })
    .onConflictDoUpdate({
      target: [postTranslations.postId, postTranslations.language],
      set: {
        sourceHash,
        sourceLanguage,
        contentHtml: translation.content,
        summary: translation.summary,
        provider: translation.provider,
        createdAt: new Date(),
      },
    });
  // Remember the language of a post that came without one.
  if (!post.language && sourceLanguage !== 'und') {
    await ctx.db.update(posts).set({ language: sourceLanguage }).where(eq(posts.id, post.id));
  }
  return translation;
}
