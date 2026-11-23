import {
  cleanupUnattachedMedia,
  LocalMediaStorage,
  publishDueScheduledPosts,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

async function signedIn() {
  const client = new Client(app);
  const response = await client.post('/api/v1/auth/register', newUser());
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  return { client, account: response.json().user.account as { id: string; username: string } };
}

async function upload(client: Client): Promise<string> {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#06c' } })
    .png()
    .toBuffer();
  const boundary = '----disbigle-scheduled';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app().inject({
    method: 'POST',
    url: '/api/v1/media',
    payload,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      cookie: client.cookieHeader ?? '',
    },
  });
  return response.json().id as string;
}

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

describe('scheduled posts (#28)', () => {
  it('keeps a post with its photo and publishes it at its time', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    await bruno.client.post(`/api/v1/accounts/${alice.account.id}/follow`);
    const mediaId = await upload(alice.client);

    const created = await alice.client.post('/api/v1/scheduled_statuses', {
      content: `Buongiorno @${bruno.account.username}`,
      visibility: 'public',
      mediaIds: [mediaId],
      scheduledAt: inMinutes(60),
    });
    expect(created.statusCode).toBe(201);
    const scheduled = created.json();
    expect(scheduled).toMatchObject({ failed: false, params: { visibility: 'public' } });
    expect(scheduled.media.map((m: { id: string }) => m.id)).toEqual([mediaId]);

    // Only its author sees it, and nothing is published yet.
    expect((await bruno.client.get(`/api/v1/scheduled_statuses/${scheduled.id}`)).statusCode).toBe(
      404,
    );
    expect((await bruno.client.get('/api/v1/scheduled_statuses')).json()).toEqual([]);
    const profile = await bruno.client.get(`/api/v1/accounts/${alice.account.id}/statuses`);
    expect(profile.json()).toEqual([]);

    // The cleanup of unused uploads leaves its photo alone.
    const ctx = app.ctx();
    await cleanupUnattachedMedia(
      { ...ctx, storage: new LocalMediaStorage(ctx.config.MEDIA_DIR) },
      new Date(Date.now() + 3600_000),
    );
    const [kept] = await ctx.db
      .select()
      .from(schema.mediaAttachments)
      .where(eq(schema.mediaAttachments.id, mediaId));
    expect(kept).toBeDefined();

    // Not due yet; then due an hour later.
    expect(await publishDueScheduledPosts(ctx)).toEqual({ published: 0, failed: 0 });
    expect(
      await publishDueScheduledPosts(ctx, { now: new Date(Date.now() + 61 * 60_000) }),
    ).toEqual({ published: 1, failed: 0 });
    expect((await alice.client.get('/api/v1/scheduled_statuses')).json()).toEqual([]);

    const posts = (await bruno.client.get(`/api/v1/accounts/${alice.account.id}/statuses`)).json();
    expect(posts).toHaveLength(1);
    expect(posts[0].content).toContain('Buongiorno');
    expect(posts[0].media.map((m: { id: string }) => m.id)).toEqual([mediaId]);
    // The mention was notified when the post came out.
    const notifications = (await bruno.client.get('/api/v1/notifications')).json();
    expect(notifications.map((n: { type: string }) => n.type)).toContain('mention');
  });

  it('checks the time, the limits and the post itself before keeping it', async () => {
    const alice = await signedIn();
    const tooSoon = await alice.client.post('/api/v1/scheduled_statuses', {
      content: 'presto',
      scheduledAt: inMinutes(2),
    });
    expect(tooSoon.statusCode).toBe(422);
    const tooLate = await alice.client.post('/api/v1/scheduled_statuses', {
      content: 'tardi',
      scheduledAt: inMinutes(91 * 24 * 60),
    });
    expect(tooLate.statusCode).toBe(422);
    const nobody = await alice.client.post('/api/v1/scheduled_statuses', {
      content: 'a nessuno',
      visibility: 'direct',
      scheduledAt: inMinutes(30),
    });
    expect(nobody.statusCode).toBe(422);
    const empty = await alice.client.post('/api/v1/scheduled_statuses', {
      content: '',
      scheduledAt: inMinutes(30),
    });
    expect(empty.statusCode).toBe(422);

    // 25 on the same day at most.
    const day = new Date(Date.now() + 3 * 24 * 3600_000);
    day.setUTCHours(10, 0, 0, 0);
    for (let i = 0; i < 25; i++) {
      const ok = await alice.client.post('/api/v1/scheduled_statuses', {
        content: `post ${i}`,
        scheduledAt: new Date(day.getTime() + i * 60_000).toISOString(),
      });
      expect(ok.statusCode).toBe(201);
    }
    const extra = await alice.client.post('/api/v1/scheduled_statuses', {
      content: 'uno di troppo',
      scheduledAt: new Date(day.getTime() + 30 * 60_000).toISOString(),
    });
    expect(extra.statusCode).toBe(422);
  });

  it('moves, cancels, and keeps for its author a post that could not be published', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    const original = (
      await bruno.client.post('/api/v1/statuses', { content: 'Domanda?', visibility: 'public' })
    ).json();
    const reply = (
      await alice.client.post('/api/v1/scheduled_statuses', {
        content: 'Risposta',
        inReplyToId: original.id,
        scheduledAt: inMinutes(20),
      })
    ).json();
    const other = (
      await alice.client.post('/api/v1/scheduled_statuses', {
        content: 'Da annullare',
        scheduledAt: inMinutes(40),
      })
    ).json();

    const moved = await alice.client.patch(`/api/v1/scheduled_statuses/${other.id}`, {
      scheduledAt: inMinutes(10),
    });
    expect(moved.statusCode).toBe(200);
    let list = (await alice.client.get('/api/v1/scheduled_statuses')).json();
    expect(list.map((p: { id: string }) => p.id)).toEqual([other.id, reply.id]);
    expect((await alice.client.delete(`/api/v1/scheduled_statuses/${other.id}`)).statusCode).toBe(
      200,
    );

    // The post it answers is deleted meanwhile: publishing fails, the author sees why.
    await bruno.client.delete(`/api/v1/statuses/${original.id}`);
    const ctx = app.ctx();
    expect(
      await publishDueScheduledPosts(ctx, { now: new Date(Date.now() + 30 * 60_000) }),
    ).toEqual({ published: 0, failed: 1 });
    list = (await alice.client.get('/api/v1/scheduled_statuses')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: reply.id, failed: true });
    expect(list[0].error).not.toBe('');
    // Failed posts are not tried again on their own.
    expect(
      await publishDueScheduledPosts(ctx, { now: new Date(Date.now() + 60 * 60_000) }),
    ).toEqual({ published: 0, failed: 0 });
  });
});
