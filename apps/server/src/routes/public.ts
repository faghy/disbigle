import {
  ACCEPTED_MEDIA_TYPES,
  type CoreContext,
  DomainError,
  findActorByHandle,
  findLocalActorByUsername,
  getAccountWithCounts,
  getInstanceSettings,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  translationEnabled,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { type InstanceInfo, MAX_POST_LENGTH } from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';

export const VERSION = '0.1.0';

export async function publicRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/instance', async (): Promise<InstanceInfo> => {
    const [anyUser] = await ctx.db.select({ id: schema.users.id }).from(schema.users).limit(1);
    const settings = await getInstanceSettings(ctx);
    return {
      domain: ctx.config.LOCAL_DOMAIN,
      title: settings.title,
      description: settings.description,
      rules: settings.rules,
      contactEmail: settings.contactEmail,
      registrationMode: anyUser ? settings.registrationMode : 'open',
      version: VERSION,
      ...(ctx.config.MATOMO_URL && ctx.config.MATOMO_SITE_ID
        ? { analytics: { matomoUrl: ctx.config.MATOMO_URL, siteId: ctx.config.MATOMO_SITE_ID } }
        : {}),
      translation: translationEnabled(ctx),
      limits: {
        maxPostLength: MAX_POST_LENGTH,
        maxMediaAttachments: 4,
        maxImageBytes: MAX_IMAGE_BYTES,
        maxVideoBytes: MAX_VIDEO_BYTES,
        acceptedMediaTypes: ACCEPTED_MEDIA_TYPES,
      },
    };
  });

  app.get<{ Params: { username: string } }>('/accounts/lookup/:username', async (request) => {
    // `alice` (local) or `alice@example.org` (remote, if already known to this server).
    const [username = '', domain = null] = request.params.username.replace(/^@/, '').split('@');
    const actor = domain
      ? await findActorByHandle(ctx, username, domain)
      : await findLocalActorByUsername(ctx, username);
    if (!actor || actor.suspendedAt) throw new DomainError('not_found', 'Account not found');
    return getAccountWithCounts(ctx, actor);
  });
}
