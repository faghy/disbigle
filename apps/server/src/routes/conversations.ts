import {
  type CoreContext,
  conversationParticipants,
  countUnreadConversations,
  getConversation,
  markConversationRead,
  presenceOf,
} from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';
import type { StreamingHub } from '../streaming.ts';

const idParams = z.object({ id: z.uuid() });
const pageQuery = z.object({
  maxId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});

/**
 * One private conversation as a chat: its messages, unread counts, read receipts and "typing".
 * The list of conversations is `GET /timelines/conversations`.
 */
export async function conversationRoutes(
  app: FastifyInstance,
  { ctx, hub }: { ctx: CoreContext; hub?: StreamingHub | undefined },
) {
  app.get('/unread_count', async (request) => ({
    count: await countUnreadConversations(ctx, requireUser(request).actorId),
  }));

  app.get('/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    return getConversation(ctx, requireUser(request).actorId, id, parse(pageQuery, request.query));
  });

  // Who of the others is around now, for those who share it (asked again every half minute).
  app.get('/:id/presence', async (request) => {
    const { id } = parse(idParams, request.params);
    const { actorId } = requireUser(request);
    const participants = await conversationParticipants(ctx, actorId, id);
    return presenceOf(
      ctx,
      participants.filter((p) => p !== actorId),
    );
  });

  app.post('/:id/read', async (request) => {
    const { id } = parse(idParams, request.params);
    const { actorId } = requireUser(request);
    const result = await markConversationRead(ctx, actorId, id);
    if (result && hub) {
      await hub.publishLive({
        type: 'conversation.read',
        conversationId: id,
        actorId,
        lastReadId: result.lastReadId,
        // The reader's other tabs and devices learn it too (their unread badge goes away).
        recipients: result.participants,
      });
    }
    return { lastReadId: result?.lastReadId ?? null };
  });

  // Sent by the web app every few seconds while someone writes; nothing is stored.
  app.post(
    '/:id/typing',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const { id } = parse(idParams, request.params);
      const { actorId } = requireUser(request);
      const participants = await conversationParticipants(ctx, actorId, id);
      if (hub) {
        await hub.publishLive({
          type: 'conversation.typing',
          conversationId: id,
          actorId,
          recipients: participants.filter((p) => p !== actorId),
        });
      }
      return { status: 'ok' };
    },
  );
}
