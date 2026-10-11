import {
  createKeywordFilter,
  deleteKeywordFilter,
  type FilterContext,
  type KeywordFilter,
  keywordFilterRequestSchema,
  listKeywordFilters,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import {
  bool,
  type FormObject,
  type FormValue,
  idParam,
  int,
  list,
  MastodonError,
  obj,
  str,
  strings,
} from '../http.ts';
import { readInput } from '../multipart.ts';
import type { Deps } from '../options.ts';

const MIN_EXPIRY = 300;
const MAX_EXPIRY = 365 * 24 * 3600;

/**
 * Mastodon contexts → ours. Mastodon's `account` (profiles) has no context of its own here: it is
 * folded into `home`, which also applies to profile timelines read through this API.
 */
export function nativeContexts(values: string[]): FilterContext[] {
  const result = new Set<FilterContext>();
  for (const value of values) {
    if (value === 'home' || value === 'account') result.add('home');
    else if (value === 'public' || value === 'notifications' || value === 'thread')
      result.add(value);
  }
  return [...result];
}

export function mastodonContexts(contexts: FilterContext[]): string[] {
  return contexts.flatMap((c) => (c === 'home' ? ['home', 'account'] : [c]));
}

/** `expires_in`: seconds (clamped to what we support); empty means "never". */
function expiresIn(value: FormValue | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  const seconds = int(value);
  if (seconds === undefined || seconds <= 0) return null;
  return Math.min(Math.max(seconds, MIN_EXPIRY), MAX_EXPIRY);
}

export function v2Filter(filter: KeywordFilter) {
  return {
    id: filter.id,
    title: filter.phrase,
    context: mastodonContexts(filter.contexts),
    expires_at: filter.expiresAt,
    // We remove matching posts on the server, so every filter behaves as `hide`.
    filter_action: 'hide' as const,
    keywords: [v2Keyword(filter)],
    statuses: [],
  };
}

const v2Keyword = (filter: KeywordFilter) => ({
  id: filter.id,
  keyword: filter.phrase,
  whole_word: filter.wholeWord,
});

const v1Filter = (filter: KeywordFilter) => ({
  id: filter.id,
  phrase: filter.phrase,
  context: mastodonContexts(filter.contexts),
  whole_word: filter.wholeWord,
  expires_at: filter.expiresAt,
  irreversible: true,
});

/** Keywords of a v2 create/update request, without those marked `_destroy`. */
function keywordAttributes(fields: FormObject) {
  return list(fields.keywords_attributes)
    .map((item) => obj(item))
    .map((k) => ({
      id: str(k.id),
      keyword: str(k.keyword)?.trim(),
      wholeWord: bool(k.whole_word),
      destroy: bool(k._destroy) ?? false,
    }));
}

const oneKeyword = () =>
  new MastodonError(422, 'Validation failed: each filter has exactly one keyword on this server');

export async function filterRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;
  const anyFlavour = { config: { anyFlavour: true } };

  const owned = async (actorId: string, id: string) => {
    const filter = (await listKeywordFilters(ctx, actorId)).find((f) => f.id === id);
    if (!filter) throw new MastodonError(404, 'Record not found');
    return filter;
  };

  /** Applies changes to a filter (core has no update yet, so this writes the row directly). */
  const updateFilter = async (
    actorId: string,
    id: string,
    changes: {
      phrase?: string | undefined;
      wholeWord?: boolean | undefined;
      contexts?: FilterContext[] | undefined;
      expiresIn?: number | null | undefined;
    },
  ) => {
    const current = await owned(actorId, id);
    const input = keywordFilterRequestSchema.parse({
      phrase: changes.phrase ?? current.phrase,
      wholeWord: changes.wholeWord ?? current.wholeWord,
      contexts:
        changes.contexts && changes.contexts.length > 0 ? changes.contexts : current.contexts,
      expiresIn: changes.expiresIn ?? null,
    });
    const expiresAt =
      changes.expiresIn === undefined
        ? current.expiresAt
          ? new Date(current.expiresAt)
          : null
        : input.expiresIn
          ? new Date(Date.now() + input.expiresIn * 1000)
          : null;
    await ctx.db
      .update(schema.keywordFilters)
      .set({
        phrase: input.phrase,
        wholeWord: input.wholeWord,
        contexts: input.contexts,
        expiresAt,
      })
      .where(and(eq(schema.keywordFilters.id, id), eq(schema.keywordFilters.actorId, actorId)));
    return owned(actorId, id);
  };

  const create = async (
    actorId: string,
    input: {
      phrase: string | undefined;
      wholeWord: boolean | undefined;
      contexts: string[];
      expires: FormValue | undefined;
    },
  ) => {
    const contexts = nativeContexts(input.contexts);
    if (contexts.length === 0)
      throw new MastodonError(422, "Validation failed: Context can't be blank");
    if (!input.phrase) throw new MastodonError(422, "Validation failed: Keyword can't be blank");
    return createKeywordFilter(ctx, actorId, {
      phrase: input.phrase,
      wholeWord: input.wholeWord ?? true,
      contexts,
      expiresIn: expiresIn(input.expires) ?? null,
    });
  };

  // --- v2 ---

  app.get('/api/v2/filters', anyFlavour, async (request) => {
    const user = requireUser(request, 'read:filters');
    return (await listKeywordFilters(ctx, user.actorId)).map(v2Filter);
  });

  app.get('/api/v2/filters/:id', anyFlavour, async (request) => {
    const user = requireUser(request, 'read:filters');
    return v2Filter(await owned(user.actorId, idParam(request)));
  });

  app.post('/api/v2/filters', anyFlavour, async (request) => {
    const user = requireUser(request, 'write:filters');
    const { fields } = await readInput(request);
    const keywords = keywordAttributes(fields).filter((k) => !k.destroy && k.keyword);
    if (keywords.length !== 1) throw oneKeyword();
    const [keyword] = keywords;
    return v2Filter(
      await create(user.actorId, {
        phrase: keyword?.keyword,
        wholeWord: keyword?.wholeWord,
        contexts: strings(fields.context),
        expires: fields.expires_in,
      }),
    );
  });

  app.put('/api/v2/filters/:id', anyFlavour, async (request) => {
    const user = requireUser(request, 'write:filters');
    const id = idParam(request);
    const { fields } = await readInput(request);
    const keywords = keywordAttributes(fields);
    // Removing the only keyword, or adding a second one, cannot be expressed here.
    if (keywords.some((k) => k.destroy || (k.keyword && k.id !== id))) throw oneKeyword();
    const edited = keywords.find((k) => k.id === id && k.keyword);
    const contexts = strings(fields.context);
    return v2Filter(
      await updateFilter(user.actorId, id, {
        phrase: edited?.keyword,
        wholeWord: edited?.wholeWord,
        contexts: contexts.length > 0 ? nativeContexts(contexts) : undefined,
        expiresIn: expiresIn(fields.expires_in),
      }),
    );
  });

  app.delete('/api/v2/filters/:id', anyFlavour, async (request) => {
    const user = requireUser(request, 'write:filters');
    await deleteKeywordFilter(ctx, user.actorId, idParam(request));
    return {};
  });

  // Keywords: one per filter, sharing the filter's id.
  app.get('/api/v2/filters/:id/keywords', anyFlavour, async (request) => {
    const user = requireUser(request, 'read:filters');
    return [v2Keyword(await owned(user.actorId, idParam(request)))];
  });
  app.post('/api/v2/filters/:id/keywords', anyFlavour, async (request) => {
    const user = requireUser(request, 'write:filters');
    await owned(user.actorId, idParam(request));
    throw oneKeyword();
  });
  app.get('/api/v2/filters/keywords/:id', anyFlavour, async (request) => {
    const user = requireUser(request, 'read:filters');
    return v2Keyword(await owned(user.actorId, idParam(request)));
  });
  app.put('/api/v2/filters/keywords/:id', anyFlavour, async (request) => {
    const user = requireUser(request, 'write:filters');
    const { fields } = await readInput(request);
    return v2Keyword(
      await updateFilter(user.actorId, idParam(request), {
        phrase: str(fields.keyword)?.trim() || undefined,
        wholeWord: bool(fields.whole_word),
      }),
    );
  });
  app.delete('/api/v2/filters/keywords/:id', anyFlavour, async (request) => {
    const user = requireUser(request, 'write:filters');
    await owned(user.actorId, idParam(request));
    throw oneKeyword();
  });
  app.get('/api/v2/filters/:id/statuses', anyFlavour, async (request) => {
    const user = requireUser(request, 'read:filters');
    await owned(user.actorId, idParam(request));
    return [];
  });
  app.post('/api/v2/filters/:id/statuses', anyFlavour, async (request) => {
    requireUser(request, 'write:filters');
    idParam(request);
    throw new MastodonError(422, 'Validation failed: filtering single posts is not supported');
  });

  // --- v1 (deprecated, still used by older apps) ---

  app.get('/api/v1/filters', async (request) => {
    const user = requireUser(request, 'read:filters');
    return (await listKeywordFilters(ctx, user.actorId)).map(v1Filter);
  });

  app.get('/api/v1/filters/:id', async (request) => {
    const user = requireUser(request, 'read:filters');
    return v1Filter(await owned(user.actorId, idParam(request)));
  });

  app.post('/api/v1/filters', async (request) => {
    const user = requireUser(request, 'write:filters');
    const { fields } = await readInput(request);
    return v1Filter(
      await create(user.actorId, {
        phrase: str(fields.phrase)?.trim(),
        wholeWord: bool(fields.whole_word),
        contexts: strings(fields.context),
        expires: fields.expires_in,
      }),
    );
  });

  app.put('/api/v1/filters/:id', async (request) => {
    const user = requireUser(request, 'write:filters');
    const { fields } = await readInput(request);
    const contexts = strings(fields.context);
    return v1Filter(
      await updateFilter(user.actorId, idParam(request), {
        phrase: str(fields.phrase)?.trim() || undefined,
        wholeWord: bool(fields.whole_word),
        contexts: contexts.length > 0 ? nativeContexts(contexts) : undefined,
        expiresIn: expiresIn(fields.expires_in),
      }),
    );
  });

  app.delete('/api/v1/filters/:id', async (request) => {
    const user = requireUser(request, 'write:filters');
    await deleteKeywordFilter(ctx, user.actorId, idParam(request));
    return {};
  });
}
