import { listAspectMembers } from '@disbigle/core';
import type { StreamEvent } from '@disbigle/shared';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { optionalUser } from '../auth.ts';
import { mapContext } from '../entities/mappers.ts';
import { isUuid, MastodonError, parseQuery, str } from '../http.ts';
import type { Deps, HubSocket, StreamingHubLike } from '../options.ts';
import { MastodonStreamEncoder, type SubscriptionRequest, toSubscription } from '../streaming.ts';

/**
 * `GET /api/v1/streaming` (WebSocket) in Mastodon format: `?stream=user&access_token=…`, or
 * `{"type":"subscribe","stream":"hashtag","tag":"x"}` messages; events carry the entity as a
 * JSON string in `payload`. Events come from the server's native hub: we register a proxy socket
 * that re-encodes each native message for this client (no change to the hub needed).
 */
export async function streamingRoutes(
  app: FastifyInstance,
  deps: Deps & { hub: StreamingHubLike },
) {
  const { ctx, hub } = deps;

  const handler = (socket: WebSocket, request: FastifyRequest) => {
    const user = optionalUser(request);
    const actorId = user?.actorId ?? null;
    const encoder = new MastodonStreamEncoder(mapContext(deps.baseUrl), actorId !== null);
    const proxy: HubSocket = {
      get readyState() {
        return socket.readyState;
      },
      send(data: string) {
        let message: StreamEvent;
        try {
          message = JSON.parse(data) as StreamEvent;
        } catch {
          return;
        }
        for (const out of encoder.encode(message)) socket.send(out);
      },
    };
    const connection = hub.add(proxy, actorId);
    const sync = () => {
      connection.streams.clear();
      for (const stream of encoder.nativeStreams()) connection.streams.add(stream);
    };
    const listMembers = async (listId: string) => {
      if (!actorId || !isUuid(listId)) return null;
      try {
        return new Set((await listAspectMembers(ctx, actorId, listId)).map((a) => a.id));
      } catch {
        return null;
      }
    };
    const subscribe = async (input: SubscriptionRequest) => {
      const result = await toSubscription(input, actorId !== null, listMembers);
      if ('error' in result) {
        socket.send(JSON.stringify({ error: result.error, status: result.status }));
        return;
      }
      encoder.add(result);
      sync();
    };

    const query = parseQuery(request);
    const initial = str(query.stream);
    const ready = initial
      ? subscribe({
          stream: initial,
          ...(str(query.tag) ? { tag: str(query.tag) as string } : {}),
          ...(str(query.list) ? { list: str(query.list) as string } : {}),
        })
      : Promise.resolve();

    socket.on('message', (raw: Buffer) => {
      let parsed: { type?: unknown; stream?: unknown; tag?: unknown; list?: unknown };
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (typeof parsed.stream !== 'string') return;
      const input: SubscriptionRequest = {
        stream: parsed.stream,
        ...(typeof parsed.tag === 'string' ? { tag: parsed.tag } : {}),
        ...(typeof parsed.list === 'string' ? { list: parsed.list } : {}),
      };
      void ready.then(async () => {
        if (parsed.type === 'subscribe') await subscribe(input);
        else if (parsed.type === 'unsubscribe') {
          const param = input.stream.startsWith('hashtag')
            ? input.tag?.replace(/^#/, '').toLowerCase()
            : input.stream === 'list'
              ? input.list
              : undefined;
          encoder.remove(input.stream, param);
          sync();
        }
      });
    });
    socket.on('close', () => hub.remove(connection));
  };

  const options = {
    websocket: true as const,
    preValidation: async (request: FastifyRequest) => {
      const auth = request.mastodonAuth;
      if (auth.kind === 'invalid') throw new MastodonError(auth.status, auth.message);
    },
  };
  app.get('/api/v1/streaming', options, handler);
  app.get('/api/v1/streaming/', options, handler);

  app.get('/api/v1/streaming/health', { config: { anyFlavour: true } }, async (_request, reply) =>
    reply.header('content-type', 'text/plain').send('OK'),
  );
}
