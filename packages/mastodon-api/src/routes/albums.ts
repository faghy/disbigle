import {
  addToAlbum,
  createAlbum,
  deleteAlbum,
  getAlbum,
  listAlbums,
  removeFromAlbum,
  updateAlbum,
} from '@disbigle/core';
import type { Album, ProfileMedia } from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';
import { requireUser, viewerId } from '../auth.ts';
import { mapMedia } from '../entities/mappers.ts';
import { Presenter } from '../entities/presenter.ts';
import { body, type FormObject, idParam, isUuid, MastodonError, str } from '../http.ts';
import type { Deps } from '../options.ts';
import { loadActor } from './accounts.ts';

/**
 * Photo albums, a Disbigle extension of the Mastodon API (the native apps use it). Entities
 * follow Mastodon's style: snake_case and Mastodon media attachments.
 */
const mapAlbum = (album: Album) => ({
  id: album.id,
  account_id: album.accountId,
  name: album.name,
  description: album.description,
  media_count: album.mediaCount,
  cover: album.cover ? mapMedia(album.cover) : null,
  updated_at: album.updatedAt,
  ...(album.includes === undefined ? {} : { includes: album.includes }),
});

const mapItem = (item: ProfileMedia) => ({
  media_attachment: mapMedia(item.media),
  status_id: item.statusId,
  sensitive: item.sensitive,
  created_at: item.createdAt,
});

function albumBody(form: FormObject) {
  const name = str(form.name)?.trim() ?? '';
  if (!name) throw new MastodonError(422, "Validation failed: Name can't be blank");
  return { name, description: str(form.description) ?? '' };
}

export async function albumRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;

  app.get('/api/v1/accounts/:id/albums', async (request) => {
    const actor = await loadActor(ctx, idParam(request));
    const mediaId = str((request.query as FormObject).media_id);
    const albums = await listAlbums(
      ctx,
      viewerId(request, 'read:statuses'),
      actor.id,
      mediaId && isUuid(mediaId) ? mediaId : undefined,
    );
    return albums.map(mapAlbum);
  });

  app.get('/api/v1/albums/:id', async (request) => {
    const viewer = viewerId(request, 'read:statuses');
    const album = await getAlbum(ctx, viewer, idParam(request));
    return {
      ...mapAlbum(album),
      account: await new Presenter(ctx, viewer).account(album.account),
      items: album.items.map(mapItem),
    };
  });

  app.post('/api/v1/albums', async (request) => {
    const user = requireUser(request, 'write:statuses');
    return mapAlbum(await createAlbum(ctx, user.actorId, albumBody(body(request))));
  });

  app.put('/api/v1/albums/:id', async (request) => {
    const user = requireUser(request, 'write:statuses');
    return mapAlbum(
      await updateAlbum(ctx, user.actorId, idParam(request), albumBody(body(request))),
    );
  });

  app.delete('/api/v1/albums/:id', async (request) => {
    const user = requireUser(request, 'write:statuses');
    await deleteAlbum(ctx, user.actorId, idParam(request));
    return {};
  });

  app.put('/api/v1/albums/:id/media/:media_id', async (request) => {
    const user = requireUser(request, 'write:statuses');
    await addToAlbum(ctx, user.actorId, idParam(request), idParam(request, 'media_id'));
    return {};
  });

  app.delete('/api/v1/albums/:id/media/:media_id', async (request) => {
    const user = requireUser(request, 'write:statuses');
    await removeFromAlbum(ctx, user.actorId, idParam(request), idParam(request, 'media_id'));
    return {};
  });
}
