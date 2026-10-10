import {
  beginPasskeyRegistration,
  beginTotpSetup,
  type CoreContext,
  changePassword,
  confirmTotpSetup,
  deletePasskey,
  disableTotp,
  finishPasskeyRegistration,
  getCurrentUser,
  listPasskeys,
  type RegistrationResponseJSON,
  regenerateRecoveryCodes,
  updateProfile,
  updateSettings,
} from '@disbigle/core';
import {
  changePasswordRequestSchema,
  mfaCodeRequestSchema,
  updateProfileRequestSchema,
  updateSettingsRequestSchema,
} from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

const passwordSchema = z.object({ password: z.string().min(1).max(256) });
const passkeyRegisterSchema = z.object({
  name: z.string().trim().max(100).default(''),
  response: z.looseObject({
    id: z.string(),
    rawId: z.string(),
    type: z.string(),
    response: z.looseObject({}),
  }),
});

/** Routes for the signed-in user's own account. */
export async function meRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/', async (request) => getCurrentUser(ctx, requireUser(request).userId));

  app.patch('/profile', async (request) => {
    const session = requireUser(request);
    return updateProfile(ctx, session.actorId, parse(updateProfileRequestSchema, request.body));
  });

  app.patch('/settings', async (request) => {
    const session = requireUser(request);
    await updateSettings(ctx, session.userId, parse(updateSettingsRequestSchema, request.body));
    return getCurrentUser(ctx, session.userId);
  });

  app.post('/password', async (request) => {
    const session = requireUser(request);
    await changePassword(
      ctx,
      session.userId,
      parse(changePasswordRequestSchema, request.body),
      session.sessionId,
    );
    return { status: 'ok' };
  });

  app.post('/totp/setup', async (request) => beginTotpSetup(ctx, requireUser(request).userId));

  app.post('/totp/confirm', async (request) => {
    const session = requireUser(request);
    const { code } = parse(mfaCodeRequestSchema, request.body);
    return { codes: await confirmTotpSetup(ctx, session.userId, code) };
  });

  app.post('/totp/disable', async (request) => {
    const session = requireUser(request);
    await disableTotp(ctx, session.userId, parse(passwordSchema, request.body).password);
    return { status: 'ok' };
  });

  app.post('/recovery-codes', async (request) => {
    const session = requireUser(request);
    const { password } = parse(passwordSchema, request.body);
    return { codes: await regenerateRecoveryCodes(ctx, session.userId, password) };
  });

  app.get('/passkeys', async (request) => listPasskeys(ctx, requireUser(request).userId));

  app.post('/passkeys/options', async (request) =>
    beginPasskeyRegistration(ctx, requireUser(request).userId),
  );

  app.post('/passkeys', async (request, reply) => {
    const session = requireUser(request);
    const input = parse(passkeyRegisterSchema, request.body);
    const passkey = await finishPasskeyRegistration(
      ctx,
      session.userId,
      input.response as unknown as RegistrationResponseJSON,
      input.name,
    );
    return reply.status(201).send(passkey);
  });

  app.delete<{ Params: { id: string } }>('/passkeys/:id', async (request) => {
    await deletePasskey(ctx, requireUser(request).userId, z.uuid().parse(request.params.id));
    return { status: 'ok' };
  });
}
