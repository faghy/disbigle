import { previewForUrl, safeGet } from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { type FormValue, MastodonError, str } from '../http.ts';
import type { Deps } from '../options.ts';

/**
 * The preview of a link while someone writes a post, for the apps (a Disbigle extension of the
 * Mastodon API, same answer as the web's `/api/v1/link_preview`): the page is read by this
 * server, never by the phone, and the preview is kept for the post that follows.
 */
export async function linkPreviewRoutes(app: FastifyInstance, deps: Deps) {
  app.get(
    '/api/v1/link_preview',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      requireUser(request, 'read');
      const raw = str((request.query as Record<string, FormValue | undefined>).url);
      let parsed: URL;
      try {
        parsed = new URL(raw ?? '');
      } catch {
        throw new MastodonError(422, 'Validation failed: url is invalid');
      }
      if (
        (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
        parsed.href.length > 2000
      )
        return { card: null };
      parsed.hash = '';
      try {
        const card = await previewForUrl(deps.mediaCtx, parsed.href, (target, options) =>
          safeGet(target, options),
        );
        return {
          card: card && {
            url: card.url,
            title: card.title,
            description: card.description,
            type: 'link',
            provider_name: card.siteName,
            image: card.image,
            width: card.width ?? 0,
            height: card.height ?? 0,
          },
        };
      } catch {
        // Unreachable, too large or not public: no preview.
        return { card: null };
      }
    },
  );
}
