import { hidePost, hideTag, listHiddenTags, unhidePost, unhideTag } from '@disbigle/core';
import type { HiddenTag } from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { Presenter } from '../entities/presenter.ts';
import { body, idParam, isUuid, MastodonError, str } from '../http.ts';
import type { Deps } from '../options.ts';

/**
 * Hiding posts and hashtags from your timelines, a Disbigle extension of the Mastodon API (the
 * native apps use it). A hashtag is hidden from everyone, or only from one account.
 */
export async function hidingRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;

  const mapHidden = async (presenter: Presenter, hidden: HiddenTag) => ({
    id: hidden.id,
    name: hidden.name,
    account: hidden.account ? await presenter.account(hidden.account) : null,
  });

  app.post('/api/v1/statuses/:id/hide', async (request) => {
    const user = requireUser(request, 'write:filters');
    await hidePost(ctx, user.actorId, idParam(request));
    return {};
  });

  app.post('/api/v1/statuses/:id/unhide', async (request) => {
    const user = requireUser(request, 'write:filters');
    await unhidePost(ctx, user.actorId, idParam(request));
    return {};
  });

  app.get('/api/v1/hidden_tags', async (request) => {
    const user = requireUser(request, 'read:filters');
    const presenter = new Presenter(ctx, user.actorId);
    const list = await listHiddenTags(ctx, user.actorId);
    return Promise.all(list.map((hidden) => mapHidden(presenter, hidden)));
  });

  app.post('/api/v1/hidden_tags', async (request) => {
    const user = requireUser(request, 'write:filters');
    const form = body(request);
    const name = str(form.name)?.trim().replace(/^#/, '') ?? '';
    if (!name || name.length > 100) throw new MastodonError(422, 'Validation failed: invalid name');
    const accountId = str(form.account_id) || null;
    if (accountId && !isUuid(accountId)) throw new MastodonError(404, 'Record not found');
    const hidden = await hideTag(ctx, user.actorId, name, accountId);
    return mapHidden(new Presenter(ctx, user.actorId), hidden);
  });

  app.delete('/api/v1/hidden_tags/:id', async (request) => {
    const user = requireUser(request, 'write:filters');
    await unhideTag(ctx, user.actorId, idParam(request));
    return {};
  });
}
