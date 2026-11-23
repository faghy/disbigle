import {
  deleteScheduledPost,
  getScheduledPost,
  listScheduledPosts,
  rescheduleScheduledPost,
} from '@disbigle/core';
import type { ScheduledPost } from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { mapMedia, mapVisibility } from '../entities/mappers.ts';
import { body, idParam, MastodonError, str } from '../http.ts';
import type { Deps } from '../options.ts';

/** Mastodon's ScheduledStatus entity. */
export function mapScheduledStatus(post: ScheduledPost) {
  const { params } = post;
  return {
    id: post.id,
    scheduled_at: post.scheduledAt,
    params: {
      text: params.content,
      poll: params.poll
        ? {
            options: params.poll.options,
            expires_in: String(params.poll.expiresIn),
            multiple: params.poll.multiple,
            hide_totals: false,
          }
        : null,
      media_ids: params.mediaIds.length > 0 ? params.mediaIds : null,
      sensitive: params.sensitive,
      spoiler_text: params.summary || null,
      visibility: mapVisibility(params.visibility),
      in_reply_to_id: params.inReplyToId ?? null,
      language: params.language ?? null,
      scheduled_at: null,
      application_id: null,
      idempotency: null,
      with_rate_limit: false,
    },
    media_attachments: post.media.map(mapMedia),
  };
}

/** `/api/v1/scheduled_statuses`: the posts waiting to be published (issue #28). */
export async function scheduledRoutes(app: FastifyInstance, { ctx }: Deps) {
  app.get('/api/v1/scheduled_statuses', async (request) => {
    const user = requireUser(request, 'read:statuses');
    return (await listScheduledPosts(ctx, user.actorId)).map(mapScheduledStatus);
  });

  app.get('/api/v1/scheduled_statuses/:id', async (request) => {
    const user = requireUser(request, 'read:statuses');
    return mapScheduledStatus(await getScheduledPost(ctx, user.actorId, idParam(request)));
  });

  app.put('/api/v1/scheduled_statuses/:id', async (request) => {
    const user = requireUser(request, 'write:statuses');
    const value = str(body(request).scheduled_at);
    const when = value ? new Date(value) : null;
    if (!when || Number.isNaN(when.getTime()))
      throw new MastodonError(422, 'Validation failed: scheduled_at is invalid');
    return mapScheduledStatus(
      await rescheduleScheduledPost(ctx, user.actorId, idParam(request), when),
    );
  });

  app.delete('/api/v1/scheduled_statuses/:id', async (request) => {
    const user = requireUser(request, 'write:statuses');
    await deleteScheduledPost(ctx, user.actorId, idParam(request));
    return {};
  });
}
