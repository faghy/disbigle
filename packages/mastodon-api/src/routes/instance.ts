import {
  ACCEPTED_MEDIA_TYPES,
  getAccountWithCounts,
  getInstanceSettings,
  getVapidKeys,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { MAX_POLL_OPTIONS, MAX_POST_LENGTH } from '@disbigle/shared';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { Presenter } from '../entities/presenter.ts';
import type { MAccount } from '../entities/types.ts';
import { type Deps, MASTODON_COMPAT_VERSION } from '../options.ts';

const anyFlavour = { config: { anyFlavour: true } };

/** 1x1 transparent PNG: the header of accounts without one (Mastodon always sends a URL). */
const MISSING_HEADER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

export async function instanceRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx, baseUrl, options } = deps;
  const version = `${MASTODON_COMPAT_VERSION} (compatible; Disbigle ${options.softwareVersion})`;
  const streaming = baseUrl.replace(/^http/, 'ws');
  const thumbnail = `${baseUrl}/icons/icon-512.png`;

  const common = async () => {
    const [settings, [anyUser], [users], [statuses], [domains], [admin]] = await Promise.all([
      getInstanceSettings(ctx),
      ctx.db.select({ id: schema.users.id }).from(schema.users).limit(1),
      ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.users)
        .where(and(eq(schema.users.approved, true), isNull(schema.users.disabledAt))),
      ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.posts)
        .where(eq(schema.posts.local, true)),
      ctx.db
        .select({ n: sql<number>`count(distinct lower(${schema.actors.domain}))::int` })
        .from(schema.actors)
        .where(isNotNull(schema.actors.domain)),
      ctx.db
        .select({ actor: schema.actors })
        .from(schema.users)
        .innerJoin(schema.actors, eq(schema.actors.id, schema.users.actorId))
        .where(eq(schema.users.role, 'admin'))
        .orderBy(schema.users.createdAt)
        .limit(1),
    ]);
    const contact: MAccount | null = admin
      ? await new Presenter(ctx, null).account(await getAccountWithCounts(ctx, admin.actor))
      : null;
    // A brand-new instance is open so that its first user can sign up as admin.
    const mode = anyUser ? settings.registrationMode : 'open';
    let vapid = '';
    try {
      vapid = (await getVapidKeys(ctx)).publicKey;
    } catch {
      // No VAPID key yet: push is simply not offered.
    }
    return {
      settings,
      mode,
      contact,
      vapid,
      stats: { users: users?.n ?? 0, statuses: statuses?.n ?? 0, domains: domains?.n ?? 0 },
      rules: settings.rules.map((text, i) => ({ id: String(i + 1), text, hint: '' })),
    };
  };

  const statusLimits = {
    max_characters: MAX_POST_LENGTH,
    max_media_attachments: 4,
    characters_reserved_per_url: 23,
  };
  const mediaLimits = {
    supported_mime_types: ACCEPTED_MEDIA_TYPES,
    image_size_limit: MAX_IMAGE_BYTES,
    image_matrix_limit: 2560 * 2560,
    video_size_limit: MAX_VIDEO_BYTES,
    video_frame_rate_limit: 60,
    video_matrix_limit: 2560 * 2560,
    description_limit: 1500,
  };
  const pollLimits = {
    max_options: MAX_POLL_OPTIONS,
    max_characters_per_option: 100,
    min_expiration: 300,
    max_expiration: 30 * 24 * 3600,
  };

  app.get('/api/v1/instance', async () => {
    const info = await common();
    return {
      uri: ctx.config.LOCAL_DOMAIN,
      title: info.settings.title,
      short_description: info.settings.description,
      description: info.settings.description,
      email: info.settings.contactEmail,
      version,
      urls: { streaming_api: streaming },
      stats: {
        user_count: info.stats.users,
        status_count: info.stats.statuses,
        domain_count: info.stats.domains,
      },
      thumbnail,
      languages: ['en', 'it'],
      registrations: info.mode !== 'closed',
      approval_required: info.mode === 'approval',
      invites_enabled: info.mode === 'invite',
      configuration: {
        accounts: { max_featured_tags: 0 },
        statuses: statusLimits,
        media_attachments: mediaLimits,
        polls: pollLimits,
      },
      contact_account: info.contact,
      rules: info.rules,
    };
  });

  app.get('/api/v2/instance', anyFlavour, async () => {
    const info = await common();
    return {
      domain: ctx.config.LOCAL_DOMAIN,
      title: info.settings.title,
      version,
      source_url: 'https://github.com/faghy/disbigle',
      description: info.settings.description,
      usage: { users: { active_month: info.stats.users } },
      thumbnail: { url: thumbnail },
      icon: [{ src: thumbnail, size: '512x512' }],
      languages: ['en', 'it'],
      configuration: {
        urls: { streaming, status: null },
        vapid: { public_key: info.vapid },
        accounts: { max_featured_tags: 0, max_pinned_statuses: 0 },
        statuses: statusLimits,
        media_attachments: mediaLimits,
        polls: pollLimits,
        translation: { enabled: false },
      },
      registrations: {
        enabled: info.mode !== 'closed',
        approval_required: info.mode === 'approval',
        message: null,
        url: null,
      },
      contact: { email: info.settings.contactEmail, account: info.contact },
      rules: info.rules,
    };
  });

  app.get('/api/v1/instance/rules', async () => (await common()).rules);
  app.get('/api/v1/instance/peers', async () => []);
  app.get('/api/v1/instance/activity', async () => []);
  app.get('/api/v1/instance/domain_blocks', async () => []);
  app.get('/api/v1/instance/translation_languages', async () => ({}));
  app.get('/api/v1/instance/extended_description', async () => {
    const settings = await getInstanceSettings(ctx);
    return { updated_at: new Date().toISOString(), content: settings.description };
  });
  app.get('/api/v1/custom_emojis', async () => []);
  app.get('/api/v1/announcements', async () => []);
  for (const path of ['tags', 'statuses', 'links']) {
    app.get(`/api/v1/trends/${path}`, async () => []);
  }
  app.get('/api/v1/trends', async () => []);

  // Features we do not have: answered with empty collections so clients degrade gracefully.
  app.get('/api/v1/scheduled_statuses', async (request) => {
    requireUser(request, 'read:statuses');
    return [];
  });

  app.get('/api/mastodon/missing-header.png', anyFlavour, async (_request, reply) =>
    reply
      .header('content-type', 'image/png')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(MISSING_HEADER),
  );
}
