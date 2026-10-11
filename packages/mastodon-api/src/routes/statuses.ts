import {
  aspectTimeline,
  bookmark,
  bookmarksTimeline,
  createPost,
  createReport,
  DomainError,
  deletePost,
  editPost,
  getStatus,
  getStatusContext,
  getVisiblePost,
  homeTimeline,
  hydrateStatuses,
  like,
  listConversations,
  publicTimeline,
  reblog,
  serializeAccount,
  tagTimeline,
  unbookmark,
  unlike,
  unreblog,
  visibleTo,
  votePoll,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { type CreatePostRequest, MAX_POLL_OPTIONS, type Status } from '@disbigle/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireUser, viewerId } from '../auth.ts';
import { mapAccount, mapPoll, parseVisibility } from '../entities/mappers.ts';
import { Presenter } from '../entities/presenter.ts';
import {
  bool,
  type FormObject,
  idParam,
  int,
  isUuid,
  MastodonError,
  obj,
  type PageParams,
  pageParams,
  parseQuery,
  setLinkHeader,
  str,
  strings,
} from '../http.ts';
import { readInput } from '../multipart.ts';
import type { Deps } from '../options.ts';
import { corePage, cursorOrder, cursorsOf, cursorWhere, newestFirst } from '../paging.ts';
import { idList, sendAccountPage } from './accounts.ts';

const { posts, likes, actors } = schema;

const MIN_POLL_SECONDS = 300;
const MAX_POLL_SECONDS = 30 * 24 * 3600;
const IDEMPOTENCY_TTL_SECONDS = 3600;

function uuids(values: string[], what: string): string[] {
  if (!values.every(isUuid)) throw new MastodonError(422, `Validation failed: unknown ${what}`);
  return values.map((v) => v.toLowerCase());
}

/** Mastodon `POST /api/v1/statuses` parameters as our create request. */
export function toCreateRequest(fields: FormObject): CreatePostRequest {
  if (str(fields.scheduled_at)) {
    throw new MastodonError(422, 'Validation failed: scheduled posts are not supported');
  }
  const request: CreatePostRequest = {
    content: str(fields.status) ?? '',
    summary: str(fields.spoiler_text) ?? '',
    sensitive: bool(fields.sensitive) ?? false,
    mediaIds: uuids(strings(fields.media_ids), 'media'),
  };
  const visibility = parseVisibility(str(fields.visibility));
  if (str(fields.visibility) && !visibility) {
    throw new MastodonError(422, 'Validation failed: visibility is invalid');
  }
  if (visibility) request.visibility = visibility;
  // Disbigle extension: `visibility=limited` with `aspect_ids[]` shares with aspects (lists).
  const aspectIds = strings(fields.aspect_ids);
  if (aspectIds.length > 0) request.aspectIds = uuids(aspectIds, 'list');
  const replyTo = str(fields.in_reply_to_id);
  if (replyTo) {
    if (!isUuid(replyTo)) throw new MastodonError(404, 'Record not found');
    request.inReplyToId = replyTo.toLowerCase();
  }
  const language = str(fields.language)?.trim();
  if (language && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)) request.language = language;
  const poll = obj(fields.poll);
  const options = strings(poll.options);
  if (options.length > 0) {
    if (options.length > MAX_POLL_OPTIONS) {
      throw new MastodonError(
        422,
        `Validation failed: a poll can have at most ${MAX_POLL_OPTIONS} options`,
      );
    }
    const expiresIn = int(poll.expires_in) ?? 24 * 3600;
    request.poll = {
      options,
      expiresIn: Math.min(Math.max(expiresIn, MIN_POLL_SECONDS), MAX_POLL_SECONDS),
      multiple: bool(poll.multiple) ?? false,
    };
  }
  return request;
}

function reportCategory(category: string | undefined) {
  if (category === 'spam' || category === 'violation') return category;
  return category === 'legal' ? 'illegal' : 'other';
}

export async function statusRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx, baseUrl } = deps;

  const sendStatuses = async (
    request: FastifyRequest,
    reply: FastifyReply,
    viewer: string | null,
    statuses: Status[],
  ) => {
    setLinkHeader(request, reply, baseUrl, cursorsOf(statuses.map((s) => s.id)), { hasNext: true });
    return new Presenter(ctx, viewer).statuses(statuses);
  };

  // --- Statuses ---

  app.post(
    '/api/v1/statuses',
    { config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const user = requireUser(request, 'write:statuses');
      const presenter = new Presenter(ctx, user.actorId);
      const key = request.headers['idempotency-key'];
      const idempotencyKey =
        typeof key === 'string' && key
          ? `mastodon:idempotency:${user.userId}:${key.slice(0, 200)}`
          : null;
      if (idempotencyKey) {
        const previous = await ctx.kv.get(idempotencyKey);
        if (previous) {
          const existing = await getStatus(ctx, user.actorId, previous).catch(() => null);
          if (existing) return presenter.status(existing);
        }
      }
      const { fields } = await readInput(request);
      const status = await createPost(ctx, user.actorId, toCreateRequest(fields));
      if (idempotencyKey) await ctx.kv.set(idempotencyKey, status.id, IDEMPOTENCY_TTL_SECONDS);
      return reply.status(200).send(await presenter.status(status));
    },
  );

  app.get('/api/v1/statuses', async (request) => {
    const viewer = viewerId(request, 'read:statuses');
    const found: Status[] = [];
    for (const id of idList(parseQuery(request).id)) {
      const status = await getStatus(ctx, viewer, id).catch(() => null);
      if (status) found.push(status);
    }
    return new Presenter(ctx, viewer).statuses(found);
  });

  app.get('/api/v1/statuses/:id', async (request) => {
    const viewer = viewerId(request, 'read:statuses');
    return new Presenter(ctx, viewer).status(await getStatus(ctx, viewer, idParam(request)));
  });

  app.put('/api/v1/statuses/:id', async (request) => {
    const user = requireUser(request, 'write:statuses');
    const id = idParam(request);
    const { fields } = await readInput(request);
    const current = await getStatus(ctx, user.actorId, id);
    const edited = await editPost(ctx, user.actorId, id, {
      content: str(fields.status) ?? current.source ?? '',
      summary: str(fields.spoiler_text) ?? '',
      sensitive: bool(fields.sensitive) ?? false,
    });
    return new Presenter(ctx, user.actorId).status(edited);
  });

  app.delete('/api/v1/statuses/:id', async (request) => {
    const user = requireUser(request, 'write:statuses');
    const id = idParam(request);
    const status = await getStatus(ctx, user.actorId, id);
    if (status.account.id !== user.actorId) throw new MastodonError(404, 'Record not found');
    // Delete-and-redraft: the response carries the source text.
    const result = await new Presenter(ctx, user.actorId).status(status, { includeSource: true });
    await deletePost(ctx, user.actorId, id);
    return result;
  });

  app.get('/api/v1/statuses/:id/context', async (request) => {
    const viewer = viewerId(request, 'read:statuses');
    const context = await getStatusContext(ctx, viewer, idParam(request));
    const presenter = new Presenter(ctx, viewer);
    return {
      ancestors: await presenter.statuses(context.ancestors),
      descendants: await presenter.statuses(context.descendants),
    };
  });

  app.get('/api/v1/statuses/:id/source', async (request) => {
    const user = requireUser(request, 'read:statuses');
    const status = await getStatus(ctx, user.actorId, idParam(request));
    if (status.account.id !== user.actorId) throw new MastodonError(404, 'Record not found');
    return { id: status.id, text: status.source ?? '', spoiler_text: status.summary };
  });

  app.get('/api/v1/statuses/:id/history', async (request) => {
    const viewer = viewerId(request, 'read:statuses');
    const status = await getStatus(ctx, viewer, idParam(request));
    const [mapped] = await new Presenter(ctx, viewer).statuses([status]);
    if (!mapped) throw new MastodonError(404, 'Record not found');
    // We keep no edit history: the current version is the only one we can show.
    return [
      {
        content: mapped.content,
        spoiler_text: mapped.spoiler_text,
        sensitive: mapped.sensitive,
        created_at: mapped.edited_at ?? mapped.created_at,
        account: mapped.account,
        poll: mapped.poll
          ? { options: mapped.poll.options.map((o) => ({ title: o.title })) }
          : null,
        media_attachments: mapped.media_attachments,
        emojis: [],
      },
    ];
  });

  const statusAction = (
    path: string,
    scopes: string[],
    run: (actorId: string, id: string) => Promise<Status>,
  ) => {
    app.post(`/api/v1/statuses/:id/${path}`, async (request) => {
      const user = requireUser(request, ...scopes);
      const status = await run(user.actorId, idParam(request));
      return new Presenter(ctx, user.actorId).status(status);
    });
  };
  statusAction('favourite', ['write:favourites'], (actor, id) => like(ctx, actor, id));
  statusAction('unfavourite', ['write:favourites'], (actor, id) => unlike(ctx, actor, id));
  statusAction('bookmark', ['write:bookmarks'], (actor, id) => bookmark(ctx, actor, id));
  statusAction('unbookmark', ['write:bookmarks'], (actor, id) => unbookmark(ctx, actor, id));
  statusAction('unreblog', ['write:statuses'], async (actor, id) => {
    const target = await getVisiblePost(ctx, actor, id);
    return unreblog(ctx, actor, target.reblogOfId ?? target.id);
  });
  // A reblog returns the new reblog wrapper, as Mastodon does (core returns the original).
  statusAction('reblog', ['write:statuses'], async (actor, id) => {
    const original = await reblog(ctx, actor, id);
    const [wrapper] = await ctx.db
      .select()
      .from(posts)
      .where(and(eq(posts.actorId, actor), eq(posts.reblogOfId, original.id)));
    if (!wrapper) return original;
    const [status] = await hydrateStatuses(ctx, actor, [wrapper]);
    return status ?? original;
  });
  for (const path of ['pin', 'unpin', 'mute', 'unmute']) {
    app.post(`/api/v1/statuses/:id/${path}`, async (request) => {
      requireUser(request, 'write:accounts', 'write:mutes');
      idParam(request);
      throw new MastodonError(422, `Validation failed: ${path} is not supported on this server`);
    });
  }

  app.get('/api/v1/statuses/:id/favourited_by', async (request, reply) => {
    const viewer = viewerId(request, 'read:accounts');
    const post = await getVisiblePost(ctx, viewer, idParam(request));
    const page = pageParams(parseQuery(request), 40, 80);
    const rows = await ctx.db
      .select({ cursor: likes.id, actor: actors })
      .from(likes)
      .innerJoin(actors, eq(actors.id, likes.actorId))
      .where(and(eq(likes.postId, post.id), cursorWhere(likes.id, page)))
      .orderBy(cursorOrder(likes.id, page))
      .limit(page.limit);
    const ordered = newestFirst(rows, page);
    return sendAccountPage(
      request,
      reply,
      deps,
      { actors: ordered.map((r) => r.actor), cursors: cursorsOf(ordered.map((r) => r.cursor)) },
      page,
    );
  });

  app.get('/api/v1/statuses/:id/reblogged_by', async (request, reply) => {
    const viewer = viewerId(request, 'read:accounts');
    const post = await getVisiblePost(ctx, viewer, idParam(request));
    const page = pageParams(parseQuery(request), 40, 80);
    const rows = await ctx.db
      .select({ cursor: posts.id, actor: actors })
      .from(posts)
      .innerJoin(actors, eq(actors.id, posts.actorId))
      .where(and(eq(posts.reblogOfId, post.id), cursorWhere(posts.id, page)))
      .orderBy(cursorOrder(posts.id, page))
      .limit(page.limit);
    const ordered = newestFirst(rows, page);
    return sendAccountPage(
      request,
      reply,
      deps,
      { actors: ordered.map((r) => r.actor), cursors: cursorsOf(ordered.map((r) => r.cursor)) },
      page,
    );
  });

  // --- Timelines ---

  app.get('/api/v1/timelines/home', async (request, reply) => {
    const user = requireUser(request, 'read:statuses');
    const page = pageParams(parseQuery(request), 20, 40);
    const statuses = await corePage((q) => homeTimeline(ctx, user.actorId, q), page);
    return sendStatuses(request, reply, user.actorId, statuses);
  });

  const filteredTimeline = async (
    request: FastifyRequest,
    reply: FastifyReply,
    viewer: string | null,
    page: PageParams,
    load: (q: Parameters<typeof homeTimeline>[2]) => Promise<Status[]>,
    keep: (status: Status) => boolean,
  ) => {
    const all = await corePage(load, page);
    // Cursors come from the unfiltered page, so filtering never ends pagination early.
    setLinkHeader(request, reply, baseUrl, cursorsOf(all.map((s) => s.id)), { hasNext: true });
    return new Presenter(ctx, viewer).statuses(all.filter(keep));
  };

  app.get('/api/v1/timelines/public', async (request, reply) => {
    const viewer = viewerId(request, 'read:statuses');
    const query = parseQuery(request);
    const page = pageParams(query, 20, 40);
    const local = bool(query.local) ?? false;
    const remote = bool(query.remote) ?? false;
    const onlyMedia = bool(query.only_media) ?? false;
    return filteredTimeline(
      request,
      reply,
      viewer,
      page,
      (q) => publicTimeline(ctx, viewer, { ...q, local }),
      (s) => (!remote || !s.account.local) && (!onlyMedia || s.media.length > 0),
    );
  });

  app.get<{ Params: { tag: string } }>('/api/v1/timelines/tag/:tag', async (request, reply) => {
    const viewer = viewerId(request, 'read:statuses');
    const query = parseQuery(request);
    const page = pageParams(query, 20, 40);
    const local = bool(query.local) ?? false;
    const onlyMedia = bool(query.only_media) ?? false;
    const tag = request.params.tag.replace(/^#/, '');
    return filteredTimeline(
      request,
      reply,
      viewer,
      page,
      (q) => tagTimeline(ctx, viewer, tag, q),
      (s) => (!local || s.account.local) && (!onlyMedia || s.media.length > 0),
    );
  });

  app.get('/api/v1/timelines/list/:id', async (request, reply) => {
    const user = requireUser(request, 'read:lists');
    const id = idParam(request);
    const page = pageParams(parseQuery(request), 20, 40);
    const statuses = await corePage((q) => aspectTimeline(ctx, user.actorId, id, q), page);
    return sendStatuses(request, reply, user.actorId, statuses);
  });

  // --- Bookmarks and favourites ---

  app.get('/api/v1/bookmarks', async (request, reply) => {
    const user = requireUser(request, 'read:bookmarks');
    const page = pageParams(parseQuery(request), 20, 40);
    const statuses = await corePage((q) => bookmarksTimeline(ctx, user.actorId, q), page);
    return sendStatuses(request, reply, user.actorId, statuses);
  });

  app.get('/api/v1/favourites', async (request, reply) => {
    const user = requireUser(request, 'read:favourites');
    const page = pageParams(parseQuery(request), 20, 40);
    // Paginated by like id, as Mastodon paginates by favourite id.
    const rows = await ctx.db
      .select({ cursor: likes.id, post: posts })
      .from(likes)
      .innerJoin(posts, eq(posts.id, likes.postId))
      .where(
        and(eq(likes.actorId, user.actorId), visibleTo(user.actorId), cursorWhere(likes.id, page)),
      )
      .orderBy(cursorOrder(likes.id, page))
      .limit(page.limit);
    const ordered = newestFirst(rows, page);
    const statuses = await hydrateStatuses(
      ctx,
      user.actorId,
      ordered.map((r) => r.post),
    );
    setLinkHeader(request, reply, baseUrl, cursorsOf(ordered.map((r) => r.cursor)), {
      hasNext: ordered.length === page.limit,
    });
    return new Presenter(ctx, user.actorId).statuses(statuses);
  });

  // --- Conversations (threads of direct posts) ---

  app.get('/api/v1/conversations', async (request, reply) => {
    const user = requireUser(request, 'read:statuses');
    const page = pageParams(parseQuery(request), 20, 40);
    const conversations = await listConversations(ctx, user.actorId, {
      ...(page.maxId ? { maxId: page.maxId } : {}),
      limit: page.limit,
    });
    const presenter = new Presenter(ctx, user.actorId);
    const statuses = await presenter.statuses(conversations.map((c) => c.lastStatus));
    const accounts = await presenter.accounts(conversations.flatMap((c) => c.accounts));
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const last = conversations[conversations.length - 1];
    if (last && conversations.length === page.limit) {
      const [path = ''] = request.url.split('?');
      reply.header(
        'Link',
        `<${baseUrl}${path}?limit=${page.limit}&max_id=${last.lastStatus.id}>; rel="next"`,
      );
    }
    return conversations.map((c, i) => ({
      id: c.id,
      unread: false,
      accounts: c.accounts.map((a) => byId.get(a.id) ?? mapAccount(presenter.map, a)),
      last_status: statuses[i] ?? null,
    }));
  });

  app.post('/api/v1/conversations/:id/read', async (request) => {
    const user = requireUser(request, 'write:conversations');
    const id = idParam(request);
    const [conversation] = (await listConversations(ctx, user.actorId, { limit: 40 })).filter(
      (c) => c.id === id,
    );
    if (!conversation) throw new MastodonError(404, 'Record not found');
    const presenter = new Presenter(ctx, user.actorId);
    return {
      id: conversation.id,
      unread: false,
      accounts: await presenter.accounts(conversation.accounts),
      last_status: await presenter.status(conversation.lastStatus),
    };
  });

  app.delete('/api/v1/conversations/:id', async (request) => {
    requireUser(request, 'write:conversations');
    idParam(request);
    throw new MastodonError(422, 'Validation failed: removing conversations is not supported');
  });

  // --- Polls ---

  const pollEntity = async (viewer: string | null, pollId: string) => {
    const [poll] = await ctx.db.select().from(schema.polls).where(eq(schema.polls.id, pollId));
    if (!poll) throw new MastodonError(404, 'Record not found');
    const status = await getStatus(ctx, viewer, poll.postId).catch((error) => {
      if (error instanceof DomainError) throw new MastodonError(404, 'Record not found');
      throw error;
    });
    if (!status.poll) throw new MastodonError(404, 'Record not found');
    return mapPoll(status.poll, viewer !== null);
  };

  app.get('/api/v1/polls/:id', async (request) =>
    pollEntity(viewerId(request, 'read:statuses'), idParam(request)),
  );

  app.post('/api/v1/polls/:id/votes', async (request) => {
    const user = requireUser(request, 'write:statuses');
    const id = idParam(request);
    const { fields } = await readInput(request);
    const choices = strings(fields.choices).map(Number);
    if (choices.length === 0 || choices.some((c) => !Number.isInteger(c))) {
      throw new MastodonError(422, 'Validation failed: choose at least one option');
    }
    try {
      await votePoll(ctx, user.actorId, id, choices);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'conflict') {
        throw new MastodonError(422, 'Validation failed: You have already voted on this poll');
      }
      throw error;
    }
    return pollEntity(user.actorId, id);
  });

  // --- Reports ---

  app.post('/api/v1/reports', async (request) => {
    const user = requireUser(request, 'write:reports');
    const { fields } = await readInput(request);
    const accountId = str(fields.account_id) ?? '';
    if (!isUuid(accountId)) throw new MastodonError(404, 'Record not found');
    const category = str(fields.category);
    const report = await createReport(ctx, user.actorId, {
      accountId,
      statusIds: uuids(strings(fields.status_ids), 'status'),
      category: reportCategory(category),
      comment: str(fields.comment) ?? '',
    });
    const [target] = await ctx.db.select().from(actors).where(eq(actors.id, accountId));
    return {
      id: report.id,
      action_taken: false,
      action_taken_at: null,
      category: category ?? 'other',
      comment: str(fields.comment) ?? '',
      forwarded: false,
      created_at: new Date().toISOString(),
      status_ids: strings(fields.status_ids),
      rule_ids: null,
      target_account: target
        ? await new Presenter(ctx, user.actorId).account(serializeAccount(target))
        : null,
    };
  });
}
