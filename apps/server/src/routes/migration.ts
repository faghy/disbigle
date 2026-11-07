import { resolveRemoteAccount } from '@disbigle/activitypub';
import {
  type CoreContext,
  createAccountImport,
  DomainError,
  listAccountImports,
  moveAccount,
  setAccountAliases,
} from '@disbigle/core';
import { accountImportKinds } from '@disbigle/shared';
import type { Federation } from '@fedify/fedify';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

/** Account migration between servers: aliases (`alsoKnownAs`) and Move. */
export async function migrationRoutes(
  app: FastifyInstance,
  { ctx, federation }: { ctx: CoreContext; federation: Federation<CoreContext> },
) {
  /** Former identities of this account (needed before moving an account here). */
  app.post('/aliases', async (request) => {
    const session = requireUser(request);
    const { accounts } = parse(
      z.object({ accounts: z.array(z.string().trim().min(3).max(500)).max(10) }),
      request.body,
    );
    const ids: string[] = [];
    for (const q of accounts) {
      const actor = await resolveRemoteAccount(federation, ctx, q, { refresh: true });
      if (!actor) throw new DomainError('not_found', `Account not found: ${q}`);
      ids.push(actor.id);
    }
    return { aliases: await setAccountAliases(ctx, session.actorId, ids) };
  });

  /** Lists exported from another server (CSV): people to follow, block or mute here. */
  app.get('/imports', async (request) => listAccountImports(ctx, requireUser(request).actorId));
  app.post(
    '/imports',
    { bodyLimit: 1024 * 1024, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const session = requireUser(request);
      const { kind, text } = parse(
        z.object({ kind: z.enum(accountImportKinds), text: z.string().max(1024 * 1024) }),
        request.body,
      );
      return reply.status(201).send(await createAccountImport(ctx, session.actorId, kind, text));
    },
  );

  /** Moves this account to another one, which must already list this account as an alias. */
  app.post(
    '/move',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request) => {
      const session = requireUser(request);
      const { target, password } = parse(
        z.object({
          target: z.string().trim().min(3).max(500),
          password: z.string().min(1).max(256),
        }),
        request.body,
      );
      const actor = await resolveRemoteAccount(federation, ctx, target, { refresh: true });
      if (!actor) throw new DomainError('not_found', 'Target account not found');
      await moveAccount(ctx, session.userId, actor.id, password);
      return { status: 'ok' };
    },
  );
}
