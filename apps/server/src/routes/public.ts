import {
  type CoreContext,
  DomainError,
  findLocalActorByUsername,
  serializeAccount,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import type { InstanceInfo } from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';

export const VERSION = '0.1.0';

export async function publicRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/instance', async (): Promise<InstanceInfo> => {
    const [anyUser] = await ctx.db.select({ id: schema.users.id }).from(schema.users).limit(1);
    return {
      domain: ctx.config.LOCAL_DOMAIN,
      title: ctx.config.INSTANCE_TITLE,
      description: ctx.config.INSTANCE_DESCRIPTION,
      registrationMode: anyUser ? ctx.config.REGISTRATION_MODE : 'open',
      version: VERSION,
    };
  });

  app.get<{ Params: { username: string } }>('/accounts/lookup/:username', async (request) => {
    const actor = await findLocalActorByUsername(ctx, request.params.username);
    if (!actor || actor.suspendedAt) throw new DomainError('not_found', 'Account not found');
    return serializeAccount(actor);
  });
}
