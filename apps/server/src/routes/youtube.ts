import { type CoreContext, DomainError } from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { youtubeThumbnail, youtubeVideo } from '../youtube.ts';

/** Title and thumbnail of YouTube videos linked in posts (see youtube.ts). */
export async function youtubeRoutes(
  app: FastifyInstance,
  { ctx, fetchFn }: { ctx: CoreContext; fetchFn?: typeof fetch },
) {
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const video = await youtubeVideo(ctx.kv, request.params.id, fetchFn);
    if (!video) throw new DomainError('not_found', 'Video not found');
    return reply.header('Cache-Control', 'public, max-age=3600').send(video);
  });

  app.get<{ Params: { id: string } }>('/:id/thumbnail', async (request, reply) => {
    const image = await youtubeThumbnail(ctx.kv, request.params.id, fetchFn);
    if (!image) throw new DomainError('not_found', 'Thumbnail not found');
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'public, max-age=86400')
      .send(image);
  });
}
