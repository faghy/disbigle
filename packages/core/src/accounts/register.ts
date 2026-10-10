import { schema, uuidv7 } from '@disbigle/db';
import { type RegisterRequest, registerRequestSchema } from '@disbigle/shared';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { generateActorKeyPair, generateEd25519KeyPair } from '../crypto/keys.ts';
import { hashPassword } from '../crypto/passwords.ts';
import { diasporaGuid } from '../crypto/tokens.ts';
import { DomainError } from '../errors.ts';
import { createDefaultAspects } from '../social/aspects.ts';
import { localActorUrls } from './urls.ts';

/** Usernames that would collide with routes or impersonate the instance. */
export const reservedUsernames = new Set([
  'root',
  'support',
  'help',
  'api',
  'inbox',
  'outbox',
  'users',
  'settings',
  'about',
  'terms',
  'privacy',
  'instance',
  'actor',
  'relay',
  'receive',
  'hcard',
  'webfinger',
  'nodeinfo',
  'public',
  'www',
  'mail',
  'postmaster',
  'abuse',
  'security',
  'webmaster',
  'hostmaster',
  'noreply',
  'system',
]);

export interface RegisteredUser {
  userId: string;
  actorId: string;
  approved: boolean;
}

export async function registerUser(
  ctx: CoreContext,
  request: RegisterRequest,
): Promise<RegisteredUser> {
  const input = registerRequestSchema.parse(request);
  const { db, config } = ctx;
  const username = input.username;

  const [{ count: userCount } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.users);
  const isFirstUser = userCount === 0;

  const mode = config.REGISTRATION_MODE;
  if (!isFirstUser && mode === 'closed') {
    throw new DomainError('registrations_closed', 'Registrations are closed on this instance');
  }
  if (reservedUsernames.has(username.toLowerCase())) {
    throw new DomainError('username_taken', 'This username is reserved');
  }

  const [existingActor] = await db
    .select({ id: schema.actors.id })
    .from(schema.actors)
    .where(
      and(sql`lower(${schema.actors.username}) = lower(${username})`, isNull(schema.actors.domain)),
    );
  if (existingActor) throw new DomainError('username_taken', 'This username is already taken');

  const [existingUser] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = lower(${input.email})`);
  if (existingUser)
    throw new DomainError('email_taken', 'This email address is already registered');

  const [passwordHash, keys, edKeys] = await Promise.all([
    hashPassword(input.password),
    generateActorKeyPair(ctx.rsaKeyBits ?? 4096),
    generateEd25519KeyPair(),
  ]);
  const guid = diasporaGuid();
  const actorId = uuidv7();
  const userId = uuidv7();
  const approved = isFirstUser || mode !== 'approval';

  try {
    await db.transaction(async (tx) => {
      if (!isFirstUser && mode === 'invite') {
        const code = input.inviteCode ?? '';
        const now = new Date();
        const [invite] = await tx
          .update(schema.invites)
          .set({ uses: sql`${schema.invites.uses} + 1` })
          .where(
            and(
              eq(schema.invites.code, code),
              or(isNull(schema.invites.expiresAt), gt(schema.invites.expiresAt, now)),
              or(
                isNull(schema.invites.maxUses),
                sql`${schema.invites.uses} < ${schema.invites.maxUses}`,
              ),
            ),
          )
          .returning({ id: schema.invites.id });
        if (!invite)
          throw new DomainError('invalid_invite', 'The invitation code is invalid or expired');
      }

      await tx.insert(schema.actors).values({
        id: actorId,
        username,
        domain: null,
        displayName: username,
        publicKeyPem: keys.publicKeyPem,
        diasporaGuid: guid,
        protocols: ['activitypub', 'diaspora'],
        ...localActorUrls(config, username, guid),
      });
      await tx.insert(schema.users).values({
        id: userId,
        actorId,
        email: input.email,
        passwordHash,
        privateKeyPem: keys.privateKeyPem,
        ed25519PrivateKeyPem: edKeys.privateKeyPem,
        ed25519PublicKeyPem: edKeys.publicKeyPem,
        role: isFirstUser ? 'admin' : 'user',
        locale: input.locale,
        approved,
        registrationReason: input.reason ?? null,
      });
    });
  } catch (error) {
    throw mapUniqueViolation(error);
  }
  await createDefaultAspects(ctx, actorId, input.locale);

  return { userId, actorId, approved };
}

/** Turns a unique-constraint race into the same error the pre-checks would have raised. */
function mapUniqueViolation(error: unknown): unknown {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const pg = cause as { code?: string; constraint_name?: string };
  if (pg?.code !== '23505') return error;
  if (pg.constraint_name === 'users_email_idx') {
    return new DomainError('email_taken', 'This email address is already registered');
  }
  return new DomainError('username_taken', 'This username is already taken');
}
