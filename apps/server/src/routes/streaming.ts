import { type CoreContext, resolveSession } from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isValidStream, type StreamingHub } from '../streaming.ts';

const clientMessage = z.object({
  type: z.enum(['subscribe', 'unsubscribe']),
  stream: z.string().max(110),
});

/**
 * WebSocket endpoint. Clients pass `?stream=user` (repeatable) or send
 * `{"type":"subscribe","stream":"hashtag:fediverse"}` messages.
 */
export async function streamingRoutes(
  app: FastifyInstance,
  { hub, ctx, recheckMs = 60_000 }: { hub: StreamingHub; ctx: CoreContext; recheckMs?: number },
) {
  const allowedOrigin = new URL(ctx.config.PUBLIC_URL).origin;
  app.get('/', { websocket: true }, (socket, request) => {
    // Browsers send cookies on cross-site WebSocket handshakes too: only our own pages get a
    // signed-in stream.
    const origin = request.headers.origin;
    const trusted = !origin || origin === allowedOrigin;
    const token = trusted ? request.sessionToken : null;
    const actorId = trusted && request.session?.stage === 'active' ? request.session.actorId : null;
    const connection = hub.add(socket, actorId);

    // Signing out, a password change or a suspension end the stream as well.
    const recheck =
      actorId && token
        ? setInterval(async () => {
            const session = await resolveSession(ctx, token).catch(() => undefined);
            if (session === undefined) return;
            if (session?.stage !== 'active' || session.actorId !== actorId) socket.close(4401);
          }, recheckMs)
        : null;

    const subscribe = (stream: string) => {
      const normalized = stream.toLowerCase();
      if (isValidStream(normalized, actorId !== null)) connection.streams.add(normalized);
      else socket.send(JSON.stringify({ error: 'invalid_stream', stream }));
    };
    const query = request.query as Record<string, string | string[] | undefined>;
    const initial = query.stream;
    for (const stream of Array.isArray(initial) ? initial : initial ? [initial] : [])
      subscribe(stream);

    socket.on('message', (raw: Buffer) => {
      const parsed = clientMessage.safeParse(
        (() => {
          try {
            return JSON.parse(raw.toString());
          } catch {
            return null;
          }
        })(),
      );
      if (!parsed.success) return;
      if (parsed.data.type === 'subscribe') subscribe(parsed.data.stream);
      else connection.streams.delete(parsed.data.stream.toLowerCase());
    });
    socket.on('close', () => {
      if (recheck) clearInterval(recheck);
      hub.remove(connection);
    });
  });
}
