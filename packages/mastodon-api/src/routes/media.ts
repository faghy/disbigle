import {
  MAX_VIDEO_BYTES,
  serializeMedia,
  updateMediaDescription,
  uploadMedia,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { mapMedia } from '../entities/mappers.ts';
import { idParam, MastodonError, str } from '../http.ts';
import { readInput } from '../multipart.ts';
import type { Deps } from '../options.ts';

export async function mediaRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx, mediaCtx } = deps;

  const upload = (path: string, anyFlavour: boolean) =>
    app.post(
      path,
      { config: { anyFlavour, rateLimit: { max: 30, timeWindow: '5 minutes' } } },
      async (request) => {
        const user = requireUser(request, 'write:media');
        if (!request.isMultipart()) {
          throw new MastodonError(422, 'Validation failed: File content type is invalid');
        }
        const { fields, files } = await readInput(request, { fileSize: MAX_VIDEO_BYTES, files: 1 });
        const file = files.find((f) => f.field === 'file');
        if (!file) throw new MastodonError(422, "Validation failed: File can't be blank");
        const media = await uploadMedia(mediaCtx, user.actorId, {
          data: file.data,
          mimeType: file.mimetype,
          description: str(fields.description) ?? '',
        });
        // Processing is synchronous, so v2 can answer 200 (not 202) with the final URL.
        return mapMedia(media);
      },
    );
  upload('/api/v1/media', false);
  upload('/api/v2/media', true);

  app.get('/api/v1/media/:id', async (request) => {
    const user = requireUser(request, 'write:media');
    const [row] = await ctx.db
      .select()
      .from(schema.mediaAttachments)
      .where(
        and(
          eq(schema.mediaAttachments.id, idParam(request)),
          eq(schema.mediaAttachments.actorId, user.actorId),
        ),
      );
    if (!row) throw new MastodonError(404, 'Record not found');
    return mapMedia(serializeMedia(ctx, row));
  });

  app.put('/api/v1/media/:id', async (request) => {
    const user = requireUser(request, 'write:media');
    const id = idParam(request);
    const { fields } = await readInput(request);
    const description = str(fields.description);
    if (description === undefined) {
      const [row] = await ctx.db
        .select()
        .from(schema.mediaAttachments)
        .where(
          and(
            eq(schema.mediaAttachments.id, id),
            eq(schema.mediaAttachments.actorId, user.actorId),
          ),
        );
      if (!row) throw new MastodonError(404, 'Record not found');
      return mapMedia(serializeMedia(ctx, row));
    }
    return mapMedia(await updateMediaDescription(ctx, user.actorId, id, description));
  });
}
