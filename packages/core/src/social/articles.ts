import { isLocalDomain } from '@disbigle/config';
import { schema } from '@disbigle/db';
import { type Locale, type Status, supportedLocales } from '@disbigle/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { createPost } from './posts.ts';

/**
 * Articles of a website (the Cleitext "disbigle" plugin) announced on the fediverse. The site
 * sends the article in every language it has; the post goes out in the main language, and the
 * people it mentions on this server read it in their own language when the site has it: their
 * language never leaves the server.
 */

const translationSchema = z.object({
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(1000).default(''),
  url: z.url().max(2000),
});

export const publishArticleSchema = z.object({
  /** One version per language; `en` (or the first one) is the main post. */
  translations: z
    .partialRecord(z.enum(supportedLocales), translationSchema)
    .refine((t) => Object.keys(t).length > 0, 'At least one language'),
  /** Main language, when not English. */
  language: z.enum(supportedLocales).optional(),
  /** People to mention, as `user@server` (with or without the leading @). */
  mentions: z
    .array(
      z
        .string()
        .trim()
        .regex(/^@?[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/),
    )
    .max(20)
    .default([]),
  /** Hashtags, without #. */
  tags: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[\p{L}\p{N}_]{1,100}$/u),
    )
    .max(10)
    .default([]),
});
export type PublishArticleRequest = z.input<typeof publishArticleSchema>;

export interface PublishedArticle {
  status: Status;
  /** Replies in the thread for mentioned people who read another language. */
  replies: { language: Locale; status: Status }[];
}

const { actors, users } = schema;

const languageNames: Record<Locale, string> = {
  en: 'English',
  it: 'Italiano',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  zh: '中文',
};

/** Markdown link text cannot hold brackets unescaped. */
/** The order of the links to the other languages, whatever order the site sends them in. */
const linkOrder: Locale[] = ['en', 'it', 'es', 'zh', 'fr', 'de'];

const linkText = (text: string) => text.replace(/([\\[\]])/g, '\\$1');

function body(
  translation: z.infer<typeof translationSchema>,
  mentions: string[],
  extra: string[] = [],
): string {
  return [
    `**${translation.title}**`,
    translation.summary,
    translation.url,
    ...extra,
    mentions.map((m) => `@${m}`).join(' '),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The language of a mentioned person of this server, or null for anyone else. */
async function localLanguage(
  ctx: CoreContext,
  username: string,
  domain: string,
): Promise<string | null> {
  if (!isLocalDomain(ctx.config, domain)) return null;
  const [row] = await ctx.db
    .select({ locale: users.locale })
    .from(users)
    .innerJoin(actors, eq(actors.id, users.actorId))
    .where(and(sql`lower(${actors.username}) = lower(${username})`, isNull(actors.domain)));
  return row?.locale ?? null;
}

export async function publishArticle(
  ctx: CoreContext,
  authorActorId: string,
  request: PublishArticleRequest,
): Promise<PublishedArticle> {
  const input = publishArticleSchema.parse(request);
  const languages = Object.keys(input.translations) as Locale[];
  const main: Locale =
    input.language && input.translations[input.language]
      ? input.language
      : input.translations.en
        ? 'en'
        : (languages[0] as Locale);
  const mainTranslation = input.translations[main];
  if (!mainTranslation) throw new DomainError('bad_request', 'Missing main language');

  // Mentioned people of this server whose language the site has get the article in it.
  const groups = new Map<Locale, string[]>();
  // The account that posts never mentions itself (an article about it names it, too).
  const [author] = await ctx.db
    .select({ username: actors.username })
    .from(actors)
    .where(eq(actors.id, authorActorId));
  const seen = new Set<string>();
  for (const raw of input.mentions) {
    const handle = raw.replace(/^@/, '');
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const [username = '', domain = ''] = handle.split('@');
    if (
      author &&
      username.toLowerCase() === author.username.toLowerCase() &&
      isLocalDomain(ctx.config, domain)
    )
      continue;
    const language = await localLanguage(ctx, username, domain);
    const target =
      language && language !== main && input.translations[language as Locale]
        ? (language as Locale)
        : main;
    groups.set(target, [...(groups.get(target) ?? []), handle]);
  }

  const others = [...linkOrder, ...supportedLocales.filter((l) => !linkOrder.includes(l))]
    .filter((language) => language !== main)
    .map((language) => {
      const translation = input.translations[language];
      return translation ? `[${linkText(languageNames[language])}](${translation.url})` : '';
    })
    .filter(Boolean)
    .join(' · ');
  const tags = input.tags.map((tag) => `#${tag}`).join(' ');
  const status = await createPost(ctx, authorActorId, {
    content: body(mainTranslation, groups.get(main) ?? [], [others, tags].filter(Boolean)),
    visibility: 'public',
    language: main,
  });

  // One quiet reply per other language, so each person is told once, in their language.
  const replies: PublishedArticle['replies'] = [];
  for (const [language, mentions] of groups) {
    const translation = input.translations[language];
    if (language === main || !translation) continue;
    replies.push({
      language,
      status: await createPost(ctx, authorActorId, {
        content: body(translation, mentions),
        visibility: 'unlisted',
        inReplyToId: status.id,
        language,
      }),
    });
  }
  return { status, replies };
}
