import {
  type CoreContext,
  DomainError,
  MAX_VIDEO_BYTES,
  type MediaStorage,
  updateMediaDescription,
  uploadMedia,
} from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

export async function mediaRoutes(
  app: FastifyInstance,
  { ctx }: { ctx: CoreContext & { storage: MediaStorage } },
) {
  app.post(
    '/',
    { config: { rateLimit: { max: 30, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const session = requireUser(request);
      const file = await request.file({ limits: { fileSize: MAX_VIDEO_BYTES, files: 1 } });
      if (!file) throw new DomainError('bad_request', 'No file uploaded');
      const data = await file.toBuffer();
      if (file.file.truncated) throw new DomainError('bad_request', 'File is too large');
      const description = (file.fields.description as { value?: string } | undefined)?.value ?? '';
      const media = await uploadMedia(ctx, session.actorId, {
        data,
        mimeType: file.mimetype,
        description,
      });
      return reply.status(201).send(media);
    },
  );

  app.put('/:id', async (request) => {
    const session = requireUser(request);
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    const { description } = parse(z.object({ description: z.string().max(1500) }), request.body);
    return updateMediaDescription(ctx, session.actorId, id, description);
  });
}
