import {
  type CoreContext,
  DomainError,
  findLocalActorByUsername,
  serializeAccount,
} from '@disbigle/core';
import type { InstanceInfo } from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';

export const VERSION = '0.1.0';

export async function publicRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get(
    '/instance',
    async (): Promise<InstanceInfo> => ({
      domain: ctx.config.LOCAL_DOMAIN,
      title: ctx.config.LOCAL_DOMAIN,
      registrationMode: ctx.config.REGISTRATION_MODE,
      version: VERSION,
    }),
  );

  app.get<{ Params: { username: string } }>('/accounts/lookup/:username', async (request) => {
    const actor = await findLocalActorByUsername(ctx, request.params.username);
    if (!actor || actor.suspendedAt) throw new DomainError('not_found', 'Account not found');
    return serializeAccount(actor);
  });
}
