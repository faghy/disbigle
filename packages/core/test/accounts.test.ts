import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';
import { generate } from 'otplib';
import { describe, expect, it } from 'vitest';
import {
  beginTotpSetup,
  changePassword,
  confirmTotpSetup,
  DomainError,
  disableTotp,
  getCurrentUser,
  login,
  registerUser,
  resolveSession,
  revokeSession,
  updateProfile,
  verifySecondFactor,
} from '../src/index.ts';
import { uniqueUser, useTestContext } from './helpers.ts';

const ctx = useTestContext();

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code });
};

describe('registration', () => {
  it('makes the first user an admin and later users regular users', async () => {
    const first = await registerUser(ctx(), uniqueUser());
    const second = await registerUser(ctx(), uniqueUser());
    const [a] = await ctx().db.select().from(schema.users).where(eq(schema.users.id, first.userId));
    const [b] = await ctx()
      .db.select()
      .from(schema.users)
      .where(eq(schema.users.id, second.userId));
    expect(a?.role).toBe('admin');
    expect(b?.role).toBe('user');
  });

  it('creates an actor with federation identities for both protocols', async () => {
    const input = uniqueUser();
    const { actorId } = await registerUser(ctx(), input);
    const [actor] = await ctx()
      .db.select()
      .from(schema.actors)
      .where(eq(schema.actors.id, actorId));
    expect(actor?.domain).toBeNull();
    expect(actor?.apUri).toBe(`https://disbigle.test/users/${input.username}`);
    expect(actor?.diasporaGuid).toMatch(/^[0-9a-f]{16}$/);
    expect(actor?.protocols).toEqual(['activitypub', 'diaspora']);
    expect(actor?.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('rejects duplicate usernames regardless of case, and duplicate emails', async () => {
    const input = uniqueUser();
    await registerUser(ctx(), input);
    await expectCode(
      registerUser(ctx(), { ...uniqueUser(), username: input.username.toUpperCase() }),
      'username_taken',
    );
    await expectCode(
      registerUser(ctx(), { ...uniqueUser(), email: input.email.toUpperCase() }),
      'email_taken',
    );
  });

  it('rejects reserved usernames', async () => {
    await expectCode(
      registerUser(ctx(), { ...uniqueUser(), username: 'Support' }),
      'username_taken',
    );
  });
});

describe('registration modes', () => {
  it('closed mode refuses new accounts once an admin exists', async () => {
    await registerUser(ctx(), uniqueUser());
    const closed = { ...ctx(), config: { ...ctx().config, REGISTRATION_MODE: 'closed' as const } };
    await expectCode(registerUser(closed, uniqueUser()), 'registrations_closed');
  });

  it('approval mode creates accounts that cannot sign in yet', async () => {
    await registerUser(ctx(), uniqueUser());
    const approval = {
      ...ctx(),
      config: { ...ctx().config, REGISTRATION_MODE: 'approval' as const },
    };
    const input = uniqueUser();
    const result = await registerUser(approval, { ...input, reason: 'I run a pod' });
    expect(result.approved).toBe(false);
    await expectCode(
      login(ctx(), { login: input.username, password: input.password }),
      'account_pending_approval',
    );
  });

  it('invite mode requires a valid invite and counts its uses', async () => {
    await registerUser(ctx(), uniqueUser());
    const invite = { ...ctx(), config: { ...ctx().config, REGISTRATION_MODE: 'invite' as const } };
    await ctx()
      .db.insert(schema.invites)
      .values({ id: crypto.randomUUID(), code: 'WELCOME', maxUses: 1 });
    await expectCode(registerUser(invite, uniqueUser()), 'invalid_invite');
    await registerUser(invite, { ...uniqueUser(), inviteCode: 'WELCOME' });
    await expectCode(
      registerUser(invite, { ...uniqueUser(), inviteCode: 'WELCOME' }),
      'invalid_invite',
    );
  });
});

describe('sign-in and sessions', () => {
  it('signs in with username or email and resolves the session', async () => {
    const input = uniqueUser();
    const { userId } = await registerUser(ctx(), input);
    for (const loginName of [input.username, input.email.toUpperCase()]) {
      const result = await login(ctx(), { login: loginName, password: input.password });
      expect(result.status).toBe('ok');
      const session = await resolveSession(ctx(), result.token);
      expect(session).toMatchObject({ userId, stage: 'active' });
    }
  });

  it('rejects a wrong password and an unknown user with the same error', async () => {
    const input = uniqueUser();
    await registerUser(ctx(), input);
    await expectCode(
      login(ctx(), { login: input.username, password: 'nope' }),
      'invalid_credentials',
    );
    await expectCode(login(ctx(), { login: 'ghost', password: 'nope' }), 'invalid_credentials');
  });

  it('revokes a session on sign-out', async () => {
    const input = uniqueUser();
    await registerUser(ctx(), input);
    const { token } = await login(ctx(), { login: input.username, password: input.password });
    await revokeSession(ctx(), token);
    expect(await resolveSession(ctx(), token)).toBeNull();
  });

  it('changing the password signs out the other sessions', async () => {
    const input = uniqueUser();
    const { userId } = await registerUser(ctx(), input);
    const a = await login(ctx(), { login: input.username, password: input.password });
    const b = await login(ctx(), { login: input.username, password: input.password });
    const current = await resolveSession(ctx(), a.token);
    await changePassword(
      ctx(),
      userId,
      { currentPassword: input.password, newPassword: 'a brand new password' },
      current?.sessionId,
    );
    expect(await resolveSession(ctx(), a.token)).not.toBeNull();
    expect(await resolveSession(ctx(), b.token)).toBeNull();
    await expectCode(
      login(ctx(), { login: input.username, password: input.password }),
      'invalid_credentials',
    );
    expect(
      (await login(ctx(), { login: input.username, password: 'a brand new password' })).status,
    ).toBe('ok');
  });
});

describe('two-factor authentication', () => {
  async function enrolledUser() {
    const input = uniqueUser();
    const { userId } = await registerUser(ctx(), input);
    const setup = await beginTotpSetup(ctx(), userId);
    expect(setup.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    const recoveryCodes = await confirmTotpSetup(
      ctx(),
      userId,
      await generate({ secret: setup.secret }),
    );
    return { input, userId, secret: setup.secret, recoveryCodes };
  }

  it('rejects enrollment with a wrong code', async () => {
    const { userId } = await registerUser(ctx(), uniqueUser());
    await beginTotpSetup(ctx(), userId);
    await expectCode(confirmTotpSetup(ctx(), userId, '000000'), 'invalid_mfa_code');
  });

  it('requires a TOTP code after the password and rejects replays', async () => {
    const { input, userId, secret, recoveryCodes } = await enrolledUser();
    expect(recoveryCodes).toHaveLength(10);
    expect((await getCurrentUser(ctx(), userId)).totpEnabled).toBe(true);

    const first = await login(ctx(), { login: input.username, password: input.password });
    expect(first.status).toBe('mfa_required');
    expect(first.methods).toEqual(['totp', 'recovery_code']);
    expect((await resolveSession(ctx(), first.token))?.stage).toBe('mfa_pending');

    const code = await generate({ secret });
    await verifySecondFactor(ctx(), first.token, code);
    expect((await resolveSession(ctx(), first.token))?.stage).toBe('active');

    const second = await login(ctx(), { login: input.username, password: input.password });
    await expectCode(verifySecondFactor(ctx(), second.token, code), 'invalid_mfa_code');
  });

  it('accepts each recovery code once', async () => {
    const { input, recoveryCodes } = await enrolledUser();
    const code = recoveryCodes[0] ?? '';
    const first = await login(ctx(), { login: input.username, password: input.password });
    await verifySecondFactor(ctx(), first.token, code.toUpperCase());
    const second = await login(ctx(), { login: input.username, password: input.password });
    await expectCode(verifySecondFactor(ctx(), second.token, code), 'invalid_mfa_code');
  });

  it('locks a pending sign-in after too many wrong codes', async () => {
    const { input } = await enrolledUser();
    const pending = await login(ctx(), { login: input.username, password: input.password });
    for (let i = 0; i < 5; i++) {
      await expectCode(verifySecondFactor(ctx(), pending.token, 'aaaaa-bbbbb'), 'invalid_mfa_code');
    }
    await expectCode(verifySecondFactor(ctx(), pending.token, 'aaaaa-bbbbb'), 'too_many_attempts');
    expect(await resolveSession(ctx(), pending.token)).toBeNull();
  });

  it('can be disabled with the password', async () => {
    const { input, userId } = await enrolledUser();
    await expectCode(disableTotp(ctx(), userId, 'wrong'), 'wrong_password');
    await disableTotp(ctx(), userId, input.password);
    expect((await login(ctx(), { login: input.username, password: input.password })).status).toBe(
      'ok',
    );
  });
});

describe('profile', () => {
  it('updates profile fields and drops empty extra fields', async () => {
    const { actorId, userId } = await registerUser(ctx(), uniqueUser());
    const account = await updateProfile(ctx(), actorId, {
      displayName: 'Disbiglio',
      note: 'Pod admin',
      fields: [
        { name: 'Pod', value: 'diaspo.it' },
        { name: '', value: '' },
      ],
      locked: true,
    });
    expect(account).toMatchObject({
      displayName: 'Disbiglio',
      note: 'Pod admin',
      locked: true,
      local: true,
    });
    expect(account.fields).toEqual([{ name: 'Pod', value: 'diaspo.it' }]);
    expect((await getCurrentUser(ctx(), userId)).account.displayName).toBe('Disbiglio');
  });
});
