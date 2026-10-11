import {
  type ActorRow,
  block,
  type CoreContext,
  findActorByHandle,
  findLocalActorByUsername,
  follow,
  followTag,
  getAccountWithCounts,
  getCurrentUser,
  getTag,
  hydrateStatuses,
  listFollowedTags,
  MAX_IMAGE_BYTES,
  mute,
  notFilteredFor,
  pinnedStatuses,
  rejectFollowRequest,
  serializeAccount,
  unblock,
  unfollow,
  unfollowTag,
  unmute,
  updateProfile,
  updateProfileImage,
  updateSettings,
  visibleTo,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { and, eq, exists, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { optionalUser, requireUser, viewerId } from '../auth.ts';
import { mapList, mapTag, mapVisibility } from '../entities/mappers.ts';
import { Presenter } from '../entities/presenter.ts';
import type { MCredentialAccount } from '../entities/types.ts';
import {
  bool,
  type FormValue,
  idParam,
  int,
  isUuid,
  list,
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
import { cursorOrder, cursorsOf, cursorWhere, newestFirst } from '../paging.ts';

const { actors, follows, followRequests, blocks, mutes, posts, mediaAttachments, postTags, tags } =
  schema;

export async function loadActor(ctx: CoreContext, id: string): Promise<ActorRow> {
  const [actor] = await ctx.db.select().from(actors).where(eq(actors.id, id));
  if (!actor || actor.suspendedAt) throw new MastodonError(404, 'Record not found');
  return actor;
}

/** `id[]=a&id[]=b` (or `id=a`), keeping only well-formed ids. */
export function idList(value: FormValue | undefined, max = 40): string[] {
  return [
    ...new Set(
      strings(value)
        .filter(isUuid)
        .map((id) => id.toLowerCase()),
    ),
  ].slice(0, max);
}

/**
 * Accounts reached through a join table (follows, blocks, mutes, follow requests), paginated by
 * the join row id as Mastodon does. Returns the page and the cursors for the Link header.
 */
export async function pagedActors(
  ctx: CoreContext,
  source: {
    table: typeof follows | typeof blocks | typeof mutes | typeof followRequests;
    join: 'actorId' | 'targetActorId';
    where: SQL | undefined;
  },
  page: PageParams,
) {
  const { table } = source;
  const rows = await ctx.db
    .select({ cursor: table.id, actor: actors })
    .from(table)
    .innerJoin(actors, eq(actors.id, table[source.join]))
    .where(and(source.where, isNull(actors.suspendedAt), cursorWhere(table.id, page)))
    .orderBy(cursorOrder(table.id, page))
    .limit(page.limit);
  const ordered = newestFirst(rows, page);
  return {
    actors: ordered.map((r) => r.actor),
    cursors: cursorsOf(ordered.map((r) => r.cursor)),
  };
}

export async function sendAccountPage(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: Deps,
  result: Awaited<ReturnType<typeof pagedActors>>,
  page: PageParams,
) {
  setLinkHeader(request, reply, deps.baseUrl, result.cursors, {
    hasNext: result.actors.length === page.limit,
  });
  return new Presenter(deps.ctx, viewerId(request)).accounts(result.actors.map(serializeAccount));
}

/** The CredentialAccount of verify_credentials / update_credentials. */
async function credentialAccount(deps: Deps, userId: string): Promise<MCredentialAccount> {
  const { ctx } = deps;
  const me = await getCurrentUser(ctx, userId);
  const presenter = new Presenter(ctx, me.account.id);
  const account = await presenter.account(me.account);
  const [requests] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(followRequests)
    .where(eq(followRequests.targetActorId, me.account.id));
  return {
    ...account,
    source: {
      privacy: 'public',
      sensitive: false,
      language: me.locale,
      note: me.account.note,
      fields: me.account.fields.map((f) => ({ name: f.name, value: f.value, verified_at: null })),
      follow_requests_count: requests?.n ?? 0,
      hide_collections: false,
      discoverable: me.account.discoverable,
      indexable: me.account.discoverable,
    },
    role: {
      id: me.role === 'admin' ? '3' : me.role === 'moderator' ? '2' : '-99',
      name: me.role === 'user' ? '' : me.role === 'admin' ? 'Admin' : 'Moderator',
      permissions: me.role === 'admin' ? '1' : '0',
      color: '',
      highlighted: me.role !== 'user',
    },
  };
}

function profileFields(value: FormValue | undefined) {
  return list(value)
    .map((item) => obj(item))
    .map((f) => ({ name: str(f.name)?.trim() ?? '', value: str(f.value)?.trim() ?? '' }))
    .filter((f) => f.name || f.value)
    .slice(0, 4);
}

export async function accountRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx, mediaCtx, options } = deps;

  app.get('/api/v1/accounts/verify_credentials', async (request) => {
    const user = requireUser(request, 'read:accounts', 'profile');
    return credentialAccount(deps, user.userId);
  });

  app.patch(
    '/api/v1/accounts/update_credentials',
    { config: { rateLimit: { max: 30, timeWindow: '5 minutes' } } },
    async (request) => {
      const user = requireUser(request, 'write:accounts');
      const { fields, files } = await readInput(request, { fileSize: MAX_IMAGE_BYTES, files: 2 });
      const patch: Parameters<typeof updateProfile>[2] = {};
      const displayName = str(fields.display_name);
      const note = str(fields.note);
      if (displayName !== undefined) patch.displayName = displayName;
      if (note !== undefined) patch.note = note;
      for (const key of ['locked', 'bot', 'discoverable'] as const) {
        const value = bool(fields[key]);
        if (value !== undefined) patch[key] = value;
      }
      if (fields.fields_attributes !== undefined) {
        patch.fields = profileFields(fields.fields_attributes);
      }
      await updateProfile(ctx, user.actorId, patch);
      for (const file of files) {
        if (file.field === 'avatar' || file.field === 'header') {
          await updateProfileImage(mediaCtx, user.actorId, file.field, {
            data: file.data,
            mimeType: file.mimetype,
          });
        }
      }
      const language = str(obj(fields.source).language);
      if (language === 'en' || language === 'it') {
        await updateSettings(ctx, user.userId, { locale: language });
      }
      return credentialAccount(deps, user.userId);
    },
  );

  app.get('/api/v1/accounts/relationships', async (request) => {
    const user = requireUser(request, 'read:follows');
    const query = parseQuery(request);
    return new Presenter(ctx, user.actorId).relationships(idList(query.id));
  });

  app.get('/api/v1/accounts/familiar_followers', async (request) => {
    const user = requireUser(request, 'read:follows');
    const ids = idList(parseQuery(request).id);
    const presenter = new Presenter(ctx, user.actorId);
    const result = [];
    for (const id of ids) {
      // Accounts you follow that follow `id`.
      const rows = await ctx.db
        .select({ actor: actors })
        .from(follows)
        .innerJoin(actors, eq(actors.id, follows.actorId))
        .where(
          and(
            eq(follows.targetActorId, id),
            isNull(actors.suspendedAt),
            sql`exists (select 1 from ${follows} f2 where f2.actor_id = ${user.actorId} and f2.target_actor_id = ${follows.actorId})`,
          ),
        )
        .limit(5);
      result.push({
        id,
        accounts: await presenter.accounts(rows.map((r) => serializeAccount(r.actor))),
      });
    }
    return result;
  });

  app.get('/api/v1/accounts/lookup', async (request) => {
    const acct = (str(parseQuery(request).acct) ?? '').trim().replace(/^@/, '');
    const [username = '', domain] = acct.split('@');
    if (!username) throw new MastodonError(404, 'Record not found');
    const actor = domain
      ? await findActorByHandle(ctx, username, domain)
      : await findLocalActorByUsername(ctx, username);
    if (!actor || actor.suspendedAt) throw new MastodonError(404, 'Record not found');
    return new Presenter(ctx, viewerId(request)).account(await getAccountWithCounts(ctx, actor));
  });

  app.get(
    '/api/v1/accounts/search',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const user = requireUser(request, 'read:accounts');
      const query = parseQuery(request);
      const rows = await searchAccounts(deps, user.actorId, {
        q: str(query.q) ?? '',
        resolve: bool(query.resolve) ?? false,
        following: bool(query.following) ?? false,
        limit: Math.min(Math.max(int(query.limit) ?? 40, 1), 80),
        offset: Math.max(int(query.offset) ?? 0, 0),
      });
      return new Presenter(ctx, user.actorId).accounts(rows.map(serializeAccount));
    },
  );

  app.get('/api/v1/accounts/:id', async (request) => {
    const actor = await loadActor(ctx, idParam(request));
    return new Presenter(ctx, viewerId(request, 'read:accounts')).account(
      await getAccountWithCounts(ctx, actor),
    );
  });

  app.get('/api/v1/accounts/:id/statuses', async (request, reply) => {
    const actor = await loadActor(ctx, idParam(request));
    const viewer = viewerId(request, 'read:statuses');
    const query = parseQuery(request);
    const page = pageParams(query, 20, 40);
    if (bool(query.pinned)) {
      // At most five, so no pagination (and no Link header), as on Mastodon.
      if (page.maxId || page.minId || page.sinceId) return [];
      return new Presenter(ctx, viewer).statuses(await pinnedStatuses(ctx, viewer, actor.id));
    }
    if (options.backfillAccount && actor.domain !== null && !page.maxId && !page.minId) {
      // First look at a remote profile: fetch its recent public posts (bounded wait).
      const backfill = options.backfillAccount(actor).catch((error) => {
        request.log.warn({ err: error }, 'outbox backfill failed');
      });
      await Promise.race([backfill, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    const tagged = str(query.tagged)?.replace(/^#/, '').toLowerCase();
    const rows = await ctx.db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.actorId, actor.id),
          visibleTo(viewer),
          // Mastodon's `account` filter context is folded into `home` (not on your own profile).
          viewer === actor.id ? undefined : notFilteredFor(viewer, 'home'),
          bool(query.exclude_replies)
            ? sql`(${posts.inReplyToActorId} is null or ${posts.inReplyToActorId} = ${posts.actorId})`
            : undefined,
          bool(query.exclude_reblogs) || bool(query.only_media)
            ? isNull(posts.reblogOfId)
            : undefined,
          bool(query.only_media)
            ? exists(
                ctx.db
                  .select({ one: sql`1` })
                  .from(mediaAttachments)
                  .where(eq(mediaAttachments.postId, posts.id)),
              )
            : undefined,
          tagged
            ? exists(
                ctx.db
                  .select({ one: sql`1` })
                  .from(postTags)
                  .innerJoin(tags, eq(tags.id, postTags.tagId))
                  .where(and(eq(postTags.postId, posts.id), eq(tags.name, tagged))),
              )
            : undefined,
          cursorWhere(posts.id, page),
        ),
      )
      .orderBy(cursorOrder(posts.id, page))
      .limit(page.limit);
    const statuses = await hydrateStatuses(ctx, viewer, newestFirst(rows, page));
    setLinkHeader(request, reply, deps.baseUrl, cursorsOf(statuses.map((s) => s.id)), {
      hasNext: statuses.length === page.limit,
    });
    return new Presenter(ctx, viewer).statuses(statuses);
  });

  app.get('/api/v1/accounts/:id/followers', async (request, reply) => {
    const actor = await loadActor(ctx, idParam(request));
    const page = pageParams(parseQuery(request), 40, 80);
    const result = await pagedActors(
      ctx,
      { table: follows, join: 'actorId', where: eq(follows.targetActorId, actor.id) },
      page,
    );
    return sendAccountPage(request, reply, deps, result, page);
  });

  app.get('/api/v1/accounts/:id/following', async (request, reply) => {
    const actor = await loadActor(ctx, idParam(request));
    const page = pageParams(parseQuery(request), 40, 80);
    const result = await pagedActors(
      ctx,
      { table: follows, join: 'targetActorId', where: eq(follows.actorId, actor.id) },
      page,
    );
    return sendAccountPage(request, reply, deps, result, page);
  });

  app.get('/api/v1/accounts/:id/lists', async (request) => {
    const user = requireUser(request, 'read:lists');
    const id = idParam(request);
    const rows = await ctx.db
      .select({ id: schema.aspects.id, name: schema.aspects.name })
      .from(schema.aspectMemberships)
      .innerJoin(schema.aspects, eq(schema.aspects.id, schema.aspectMemberships.aspectId))
      .where(
        and(
          eq(schema.aspects.ownerActorId, user.actorId),
          eq(schema.aspectMemberships.actorId, id),
        ),
      )
      .orderBy(schema.aspects.position);
    return rows.map(mapList);
  });

  for (const path of ['featured_tags', 'identity_proofs']) {
    app.get(`/api/v1/accounts/:id/${path}`, async (request) => {
      idParam(request);
      return [];
    });
  }

  const actions = {
    follow: { run: follow, scopes: ['write:follows'] },
    unfollow: { run: unfollow, scopes: ['write:follows'] },
    block: { run: block, scopes: ['write:blocks'] },
    unblock: { run: unblock, scopes: ['write:blocks'] },
    mute: { run: mute, scopes: ['write:mutes'] },
    unmute: { run: unmute, scopes: ['write:mutes'] },
  } as const;
  for (const [name, action] of Object.entries(actions)) {
    app.post(`/api/v1/accounts/:id/${name}`, async (request) => {
      const user = requireUser(request, ...action.scopes);
      const id = idParam(request);
      await loadActor(ctx, id);
      await action.run(ctx, user.actorId, id);
      return new Presenter(ctx, user.actorId).relationship(id);
    });
  }

  app.post('/api/v1/accounts/:id/remove_from_followers', async (request) => {
    const user = requireUser(request, 'write:follows');
    const id = idParam(request);
    await rejectFollowRequest(ctx, user.actorId, id);
    return new Presenter(ctx, user.actorId).relationship(id);
  });

  // --- Blocks, mutes, suggestions, endorsements ---

  app.get('/api/v1/blocks', async (request, reply) => {
    const user = requireUser(request, 'read:blocks');
    const page = pageParams(parseQuery(request), 40, 80);
    const result = await pagedActors(
      ctx,
      { table: blocks, join: 'targetActorId', where: eq(blocks.actorId, user.actorId) },
      page,
    );
    return sendAccountPage(request, reply, deps, result, page);
  });

  app.get('/api/v1/mutes', async (request, reply) => {
    const user = requireUser(request, 'read:mutes');
    const page = pageParams(parseQuery(request), 40, 80);
    const result = await pagedActors(
      ctx,
      { table: mutes, join: 'targetActorId', where: eq(mutes.actorId, user.actorId) },
      page,
    );
    return sendAccountPage(request, reply, deps, result, page);
  });

  for (const path of [
    '/api/v1/suggestions',
    '/api/v1/endorsements',
    '/api/v1/featured_tags',
    '/api/v1/domain_blocks',
  ]) {
    app.get(path, async (request) => {
      requireUser(request, 'read');
      return [];
    });
  }
  app.get('/api/v2/suggestions', { config: { anyFlavour: true } }, async (request) => {
    requireUser(request, 'read');
    return [];
  });

  // --- Hashtags ---

  const tagEntity = async (request: FastifyRequest, name: string) => {
    const info = await getTag(ctx, optionalUser(request, 'read')?.actorId ?? null, name);
    return { ...mapTag(new Presenter(ctx, null).map, info.name, info.following), id: info.name };
  };

  app.get('/api/v1/followed_tags', async (request) => {
    const user = requireUser(request, 'read:follows');
    const presenter = new Presenter(ctx, user.actorId);
    return (await listFollowedTags(ctx, user.actorId)).map((name) => ({
      ...mapTag(presenter.map, name, true),
      id: name,
    }));
  });

  app.get<{ Params: { name: string } }>('/api/v1/tags/:name', async (request) =>
    tagEntity(request, request.params.name),
  );
  app.post<{ Params: { name: string } }>('/api/v1/tags/:name/follow', async (request) => {
    const user = requireUser(request, 'write:follows');
    await followTag(ctx, user.actorId, request.params.name);
    return tagEntity(request, request.params.name);
  });
  app.post<{ Params: { name: string } }>('/api/v1/tags/:name/unfollow', async (request) => {
    const user = requireUser(request, 'write:follows');
    await unfollowTag(ctx, user.actorId, request.params.name);
    return tagEntity(request, request.params.name);
  });

  // --- Preferences ---

  app.get('/api/v1/preferences', async (request) => {
    const user = requireUser(request, 'read:accounts');
    return {
      'posting:default:visibility': mapVisibility('public'),
      'posting:default:sensitive': false,
      'posting:default:language': user.locale,
      'reading:expand:media': 'default',
      'reading:expand:spoilers': false,
      'reading:autoplay:gifs': false,
    };
  });
}

/** Account search: name matches, `user@domain` handles, and remote lookups when asked to. */
export async function searchAccounts(
  deps: Deps,
  viewerActorId: string | null,
  input: { q: string; resolve: boolean; following: boolean; limit: number; offset: number },
): Promise<ActorRow[]> {
  const { ctx, options } = deps;
  const q = input.q.trim();
  if (!q) return [];
  const results = new Map<string, ActorRow>();
  const looksRemote = /^@?[^@\s]+@[^@\s]+$/.test(q) || /^https?:\/\//.test(q);
  if (looksRemote && input.offset === 0) {
    const [username, domain] = q.replace(/^@/, '').split('@');
    const known = username && domain ? await findActorByHandle(ctx, username, domain) : null;
    const actor =
      known ?? (input.resolve && options.resolveAccount ? await options.resolveAccount(q) : null);
    if (actor && !actor.suspendedAt) results.set(actor.id, actor);
  }
  const term = `%${q.replace(/^@/, '').replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await ctx.db
    .select()
    .from(actors)
    .where(
      and(
        or(ilike(actors.username, term), ilike(actors.displayName, term)),
        isNull(actors.suspendedAt),
        sql`(${actors.discoverable} or ${actors.domain} is null)`,
        input.following && viewerActorId
          ? inArray(
              actors.id,
              ctx.db
                .select({ id: follows.targetActorId })
                .from(follows)
                .where(eq(follows.actorId, viewerActorId)),
            )
          : undefined,
      ),
    )
    .orderBy(sql`${actors.domain} is not null`, actors.username)
    .limit(input.limit)
    .offset(input.offset);
  for (const actor of rows) results.set(actor.id, actor);
  return [...results.values()].slice(0, input.limit);
}
