import {
  type AuthenticationResponseJSON,
  beginPasskeyAuthentication,
  type CoreContext,
  confirmPasswordReset,
  finishPasskeyAuthentication,
  getCurrentUser,
  login,
  type Mailer,
  registerUser,
  requestPasswordReset,
  revokeSession,
  verifySecondFactor,
} from '@disbigle/core';
import {
  loginRequestSchema,
  mfaCodeRequestSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
} from '@disbigle/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { clearSessionCookie, setSessionCookie } from '../plugins/auth.ts';

const clientInfo = (request: FastifyRequest) => ({
  userAgent: request.headers['user-agent'],
  ip: request.ip,
});

const passkeyVerifySchema = z.object({
  challengeId: z.string().min(1).max(64),
  response: z.looseObject({
    id: z.string(),
    rawId: z.string(),
    type: z.string(),
    response: z.looseObject({}),
  }),
});

export async function authRoutes(
  app: FastifyInstance,
  { ctx, mailer }: { ctx: CoreContext; mailer: Mailer },
) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } };

  app.post('/register', strict, async (request, reply) => {
    const input = parse(registerRequestSchema, request.body);
    const result = await registerUser(ctx, input);
    if (!result.approved) return reply.status(202).send({ status: 'pending_approval' });
    const signedIn = await login(
      ctx,
      { login: input.username, password: input.password },
      clientInfo(request),
    );
    setSessionCookie(reply, ctx, signedIn.token, signedIn.expiresAt);
    return reply.status(201).send({ status: 'ok', user: await getCurrentUser(ctx, result.userId) });
  });

  app.post('/login', strict, async (request, reply) => {
    const input = parse(loginRequestSchema, request.body);
    const result = await login(ctx, input, clientInfo(request));
    setSessionCookie(reply, ctx, result.token, result.expiresAt);
    return { status: result.status, methods: result.methods };
  });

  app.post('/mfa', strict, async (request) => {
    const { code } = parse(mfaCodeRequestSchema, request.body);
    await verifySecondFactor(ctx, request.sessionToken ?? '', code);
    return { status: 'ok' };
  });

  app.post('/logout', async (request, reply) => {
    if (request.sessionToken) await revokeSession(ctx, request.sessionToken);
    clearSessionCookie(reply);
    return { status: 'ok' };
  });

  app.post('/passkey/options', strict, async (request) => {
    const pending = request.session?.stage === 'mfa_pending' ? request.sessionToken : null;
    return beginPasskeyAuthentication(ctx, pending ?? undefined);
  });

  app.post('/passkey/verify', strict, async (request, reply) => {
    const input = parse(passkeyVerifySchema, request.body);
    const pending = request.session?.stage === 'mfa_pending' ? request.sessionToken : null;
    const result = await finishPasskeyAuthentication(
      ctx,
      {
        challengeId: input.challengeId,
        response: input.response as unknown as AuthenticationResponseJSON,
        ...(pending ? { pendingSessionToken: pending } : {}),
      },
      clientInfo(request),
    );
    if (result.token && result.expiresAt)
      setSessionCookie(reply, ctx, result.token, result.expiresAt);
    return { status: 'ok' };
  });

  app.post(
    '/password/forgot',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request) => {
      const { email } = parse(passwordResetRequestSchema, request.body);
      await requestPasswordReset({ ...ctx, mailer }, email);
      return { status: 'ok' };
    },
  );

  app.post('/password/reset', strict, async (request) => {
    await confirmPasswordReset(ctx, parse(passwordResetConfirmSchema, request.body));
    return { status: 'ok' };
  });
}
