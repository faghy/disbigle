import { DomainError } from '@disbigle/core';
import type { OAuthStore } from '@disbigle/mastodon-api';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

/** Apps the user authorized through OAuth (Mastodon-compatible clients), and revoking them. */
export async function authorizedAppRoutes(app: FastifyInstance, { store }: { store: OAuthStore }) {
  app.get('/', async (request) => {
    const session = requireUser(request);
    const tokens = await store.listUserTokens(session.userId);
    return Promise.all(
      tokens.map(async (token) => {
        const application = await store.findApplication(token.applicationId);
        return {
          id: token.id,
          name: application?.name ?? '',
          website: application?.website ?? null,
          scopes: token.scopes,
          createdAt: token.createdAt.toISOString(),
          lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
        };
      }),
    );
  });

  app.delete('/:id', async (request) => {
    const session = requireUser(request);
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    const owned = (await store.listUserTokens(session.userId)).some((t) => t.id === id);
    if (!owned) throw new DomainError('not_found', 'Authorization not found');
    await store.revokeToken(id);
    return { status: 'ok' };
  });
}
