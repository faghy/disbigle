import { schema, uuidv7 } from '@disbigle/db';
import type { Passkey } from '@disbigle/shared';
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { and, eq } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { randomToken } from '../crypto/tokens.ts';
import { DomainError } from '../errors.ts';
import {
  activateSession,
  assertCanSignIn,
  type ClientInfo,
  createSession,
  markSignedIn,
  resolveSession,
} from './sessions.ts';

const CHALLENGE_TTL_SECONDS = 5 * 60;

function relyingParty(ctx: CoreContext) {
  const origin = ctx.config.PUBLIC_URL;
  return { origin, rpID: new URL(origin).hostname, rpName: ctx.config.LOCAL_DOMAIN };
}

export async function listPasskeys(ctx: CoreContext, userId: string): Promise<Passkey[]> {
  const rows = await ctx.db
    .select()
    .from(schema.webauthnCredentials)
    .where(eq(schema.webauthnCredentials.userId, userId))
    .orderBy(schema.webauthnCredentials.createdAt);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function deletePasskey(
  ctx: CoreContext,
  userId: string,
  passkeyId: string,
): Promise<void> {
  const { webauthnCredentials: creds } = schema;
  const deleted = await ctx.db
    .delete(creds)
    .where(and(eq(creds.id, passkeyId), eq(creds.userId, userId)))
    .returning({ id: creds.id });
  if (deleted.length === 0) throw new DomainError('not_found', 'Passkey not found');
}

export async function beginPasskeyRegistration(
  ctx: CoreContext,
  userId: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const [row] = await ctx.db
    .select({ actor: schema.actors })
    .from(schema.users)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.users.actorId))
    .where(eq(schema.users.id, userId));
  if (!row) throw new DomainError('not_found', 'User not found');

  const existing = await ctx.db
    .select({
      credentialId: schema.webauthnCredentials.credentialId,
      transports: schema.webauthnCredentials.transports,
    })
    .from(schema.webauthnCredentials)
    .where(eq(schema.webauthnCredentials.userId, userId));

  const { rpID, rpName } = relyingParty(ctx);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: `${row.actor.username}@${ctx.config.LOCAL_DOMAIN}`,
    userDisplayName: row.actor.displayName || row.actor.username,
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  await ctx.kv.set(`webauthn-reg:${userId}`, options.challenge, CHALLENGE_TTL_SECONDS);
  return options;
}

export async function finishPasskeyRegistration(
  ctx: CoreContext,
  userId: string,
  response: RegistrationResponseJSON,
  name: string,
): Promise<Passkey> {
  const expectedChallenge = await ctx.kv.get(`webauthn-reg:${userId}`);
  if (!expectedChallenge) throw new DomainError('bad_request', 'Registration expired, start again');
  await ctx.kv.del(`webauthn-reg:${userId}`);

  const { origin, rpID } = relyingParty(ctx);
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (error) {
    throw new DomainError(
      'bad_request',
      `Passkey verification failed: ${(error as Error).message}`,
    );
  }
  if (!verification.verified) throw new DomainError('bad_request', 'Passkey verification failed');

  const { credential } = verification.registrationInfo;
  const id = uuidv7();
  const [row] = await ctx.db
    .insert(schema.webauthnCredentials)
    .values({
      id,
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      name: name.trim().slice(0, 100) || 'Passkey',
    })
    .returning();
  if (!row) throw new Error('Insert failed');
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString(), lastUsedAt: null };
}

/**
 * Starts a passkey sign-in. Without a pending session the browser may offer any discoverable
 * passkey for this site; with a pending session (second factor) only that user's passkeys are allowed.
 */
export async function beginPasskeyAuthentication(
  ctx: CoreContext,
  pendingSessionToken?: string,
): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  let allowCredentials: { id: string; transports: AuthenticatorTransportFuture[] }[] | undefined;
  if (pendingSessionToken) {
    const session = await resolveSession(ctx, pendingSessionToken);
    if (session?.stage === 'mfa_pending') {
      const creds = await ctx.db
        .select()
        .from(schema.webauthnCredentials)
        .where(eq(schema.webauthnCredentials.userId, session.userId));
      allowCredentials = creds.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransportFuture[],
      }));
    }
  }
  const options = await generateAuthenticationOptions({
    rpID: relyingParty(ctx).rpID,
    userVerification: 'preferred',
    ...(allowCredentials ? { allowCredentials } : {}),
  });
  const challengeId = randomToken(16);
  await ctx.kv.set(`webauthn-auth:${challengeId}`, options.challenge, CHALLENGE_TTL_SECONDS);
  return { challengeId, options };
}

/**
 * Completes a passkey sign-in. Upgrades the pending session when one is given (second factor),
 * otherwise creates a new active session (passwordless sign-in).
 */
export async function finishPasskeyAuthentication(
  ctx: CoreContext,
  input: {
    challengeId: string;
    response: AuthenticationResponseJSON;
    pendingSessionToken?: string;
  },
  client: ClientInfo = {},
): Promise<{ token?: string; expiresAt?: Date }> {
  const key = `webauthn-auth:${input.challengeId}`;
  const expectedChallenge = await ctx.kv.get(key);
  if (!expectedChallenge) throw new DomainError('bad_request', 'Sign-in expired, start again');
  await ctx.kv.del(key);

  const { webauthnCredentials: creds, users, actors } = schema;
  const [row] = await ctx.db
    .select({ cred: creds, user: users, actor: actors })
    .from(creds)
    .innerJoin(users, eq(users.id, creds.userId))
    .innerJoin(actors, eq(actors.id, users.actorId))
    .where(eq(creds.credentialId, input.response.id));
  if (!row) throw new DomainError('invalid_credentials', 'Unknown passkey');

  const { origin, rpID } = relyingParty(ctx);
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: row.cred.credentialId,
        publicKey: new Uint8Array(row.cred.publicKey),
        counter: row.cred.counter,
        transports: row.cred.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: false,
    });
  } catch {
    throw new DomainError('invalid_credentials', 'Passkey verification failed');
  }
  if (!verification.verified)
    throw new DomainError('invalid_credentials', 'Passkey verification failed');

  await ctx.db
    .update(creds)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(creds.id, row.cred.id));
  assertCanSignIn(row.user, row.actor);

  if (input.pendingSessionToken) {
    const session = await resolveSession(ctx, input.pendingSessionToken);
    if (session?.stage !== 'mfa_pending' || session.userId !== row.user.id) {
      throw new DomainError('unauthorized', 'No pending sign-in for this passkey');
    }
    await activateSession(ctx, session.sessionId, session.userId);
    return {};
  }

  const session = await createSession(ctx, row.user.id, 'active', client);
  await markSignedIn(ctx, row.user.id);
  return session;
}
