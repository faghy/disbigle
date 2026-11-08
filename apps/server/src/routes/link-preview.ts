import { type CoreContext, type MediaStorage, previewForUrl, safeGet } from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

/**
 * The preview of a link while someone writes a post: read now by the server (never by the
 * browser, so the site learns nothing about the writer) and kept for the post that follows.
 */
export async function linkPreviewRoutes(
  app: FastifyInstance,
  {
    ctx,
    allowPrivateAddress = false,
  }: { ctx: CoreContext & { storage: MediaStorage }; allowPrivateAddress?: boolean },
) {
  app.get('/', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    requireUser(request);
    const { url } = parse(z.object({ url: z.url().max(2000) }), request.query);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { card: null };
    parsed.hash = '';
    try {
      const card = await previewForUrl(ctx, parsed.href, (target, options) =>
        safeGet(target, { ...options, allowPrivateAddress }),
      );
      return { card };
    } catch {
      // Unreachable, too large or not public: no preview.
      return { card: null };
    }
  });
}
