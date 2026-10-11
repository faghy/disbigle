import { type CoreContext, getVapidKeys, subscribePush, unsubscribePush } from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

const alerts = z
  .object({
    follow: z.boolean(),
    follow_request: z.boolean(),
    mention: z.boolean(),
    reply: z.boolean(),
    reblog: z.boolean(),
    like: z.boolean(),
    poll: z.boolean(),
  })
  .partial();

/** Web Push: the VAPID key for the browser, and the user's subscriptions. */
export async function pushRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/key', async () => ({ publicKey: (await getVapidKeys(ctx)).publicKey }));

  app.post('/subscription', async (request) => {
    const session = requireUser(request);
    const input = parse(
      z.object({
        subscription: z.object({
          endpoint: z.string().url().max(2048),
          keys: z.object({
            p256dh: z.string().min(10).max(200),
            auth: z.string().min(10).max(100),
          }),
        }),
        alerts: alerts.optional(),
      }),
      request.body,
    );
    return subscribePush(ctx, session.userId, {
      ...input.subscription,
      ...(input.alerts ? { alerts: input.alerts } : {}),
    });
  });

  app.delete('/subscription', async (request) => {
    const session = requireUser(request);
    const { endpoint } = parse(z.object({ endpoint: z.string().max(2048) }), request.query);
    await unsubscribePush(ctx, session.userId, endpoint);
    return { status: 'ok' };
  });
}
