import {
  beginPasskeyRegistration,
  beginTotpSetup,
  type CoreContext,
  changePassword,
  confirmTotpSetup,
  DomainError,
  deletePasskey,
  disableTotp,
  exportAccount,
  finishPasskeyRegistration,
  getCurrentUser,
  listContacts,
  listPasskeys,
  MAX_IMAGE_BYTES,
  type MediaStorage,
  type RegistrationResponseJSON,
  regenerateRecoveryCodes,
  removeProfileImage,
  requestAccountDeletion,
  serializeAccount,
  updateProfile,
  updateProfileImage,
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
import { clearSessionCookie, requireUser } from '../plugins/auth.ts';

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
export async function meRoutes(
  app: FastifyInstance,
  { ctx, mediaCtx }: { ctx: CoreContext; mediaCtx: CoreContext & { storage: MediaStorage } },
) {
  // The people you are connected with; ?aspectId= narrows to one aspect, ?only=followers to
  // those who follow you without being followed back.
  app.get('/contacts', async (request) => {
    const query = parse(
      z.object({
        aspectId: z.uuid().optional(),
        only: z.enum(['followers']).optional(),
        offset: z.coerce.number().int().min(0).max(10_000).optional(),
        limit: z.coerce.number().int().min(1).max(80).optional(),
      }),
      request.query,
    );
    const rows = await listContacts(ctx, requireUser(request).actorId, {
      ...(query.aspectId ? { aspectId: query.aspectId } : {}),
      onlyFollowers: query.only === 'followers',
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });
    return rows.map(({ actor, relationship }) => ({
      account: serializeAccount(actor),
      relationship,
    }));
  });

  for (const kind of ['avatar', 'header'] as const) {
    app.post(
      `/${kind}`,
      { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
      async (request) => {
        const session = requireUser(request);
        const file = await request.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
        if (!file) throw new DomainError('bad_request', 'No file uploaded');
        const data = await file.toBuffer();
        if (file.file.truncated) throw new DomainError('bad_request', 'Image is too large');
        await updateProfileImage(mediaCtx, session.actorId, kind, {
          data,
          mimeType: file.mimetype,
        });
        return getCurrentUser(ctx, session.userId);
      },
    );
    app.delete(`/${kind}`, async (request) => {
      const session = requireUser(request);
      await removeProfileImage(mediaCtx, session.actorId, kind);
      return getCurrentUser(ctx, session.userId);
    });
  }

  app.get('/', async (request) => getCurrentUser(ctx, requireUser(request).userId));

  app.get(
    '/export',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const session = requireUser(request);
      const data = await exportAccount(ctx, session.userId);
      const date = new Date().toISOString().slice(0, 10);
      return reply
        .header(
          'content-disposition',
          `attachment; filename="disbigle-${data.account.handle.replace(/[^a-zA-Z0-9._@-]/g, '_')}-${date}.json"`,
        )
        .send(data);
    },
  );

  app.post(
    '/delete',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const session = requireUser(request);
      const { password } = parse(passwordSchema, request.body);
      await requestAccountDeletion(ctx, session.userId, password);
      clearSessionCookie(reply);
      return { status: 'ok' };
    },
  );

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
    await deletePasskey(
      ctx,
      requireUser(request).userId,
      parse(z.object({ id: z.uuid() }), request.params).id,
    );
    return { status: 'ok' };
  });
}
