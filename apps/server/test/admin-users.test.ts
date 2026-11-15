import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { Client, newUser, testMailer, useTestApp } from './helpers.ts';

const app = useTestApp();

async function signUp() {
  const client = new Client(app);
  const user = newUser();
  const response = await client.post('/api/v1/auth/register', user);
  expect(response.statusCode).toBe(201);
  return { client, user };
}

/** The first account of the file is the administrator; later ones are made one. */
async function signUpAdmin() {
  const admin = await signUp();
  await app
    .ctx()
    .db.update(schema.users)
    .set({ role: 'admin' })
    .where(eq(schema.users.email, admin.user.email));
  return admin;
}

const userRow = async (email: string) => {
  const [row] = await app.ctx().db.select().from(schema.users).where(eq(schema.users.email, email));
  return row;
};

describe('admin: users', () => {
  it('corrects data, tells the old address and keeps a log', async () => {
    const admin = await signUpAdmin();
    const member = await signUp();
    const id = (await userRow(member.user.email))?.id ?? '';
    const sent = testMailer.sent.length;

    const updated = await admin.client.patch(`/api/v1/admin/users/${id}`, {
      email: 'new.address@example.org',
      displayName: 'Ren',
      locale: 'zh',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      email: 'new.address@example.org',
      locale: 'zh',
      account: { displayName: 'Ren' },
    });
    expect(updated.json().log[0]).toMatchObject({ action: 'update_user' });
    // The old (confirmed) address hears about it, in the person's language.
    expect(testMailer.sent.slice(sent)).toContainEqual(
      expect.objectContaining({ to: member.user.email, subject: '你的账号邮箱地址已更改' }),
    );

    // An address already used by someone else is refused.
    const taken = await admin.client.patch(`/api/v1/admin/users/${id}`, {
      email: admin.user.email,
    });
    expect(taken.statusCode).toBe(409);
  });

  it('lists unconfirmed addresses, sends the link again, confirms by hand or deletes', async () => {
    const admin = await signUpAdmin();
    const waiting = await signUp();
    const other = await signUp();
    const db = app.ctx().db;
    for (const email of [waiting.user.email, other.user.email])
      await db
        .update(schema.users)
        .set({ emailVerifiedAt: null, lastSignInAt: null })
        .where(eq(schema.users.email, email));
    const waitingId = (await userRow(waiting.user.email))?.id ?? '';
    const otherId = (await userRow(other.user.email))?.id ?? '';

    const list = (await admin.client.get('/api/v1/admin/users?status=unconfirmed')).json();
    expect(list.map((u: { userId: string }) => u.userId).sort()).toEqual(
      [waitingId, otherId].sort(),
    );
    expect(list[0].emailVerified).toBe(false);

    const sent = testMailer.sent.length;
    expect(
      (await admin.client.post(`/api/v1/admin/users/${waitingId}/resend_confirmation`)).statusCode,
    ).toBe(200);
    expect(testMailer.sent.slice(sent).map((m) => m.to)).toEqual([waiting.user.email]);

    expect(
      (await admin.client.post(`/api/v1/admin/users/${waitingId}/confirm_email`)).statusCode,
    ).toBe(200);
    expect((await userRow(waiting.user.email))?.emailVerifiedAt).not.toBeNull();
    // Already confirmed: neither again nor deletion here.
    expect(
      (await admin.client.post(`/api/v1/admin/users/${waitingId}/confirm_email`)).statusCode,
    ).toBe(409);
    expect(
      (await admin.client.post(`/api/v1/admin/users/${waitingId}/delete_unconfirmed`)).statusCode,
    ).toBe(409);

    expect(
      (await admin.client.post(`/api/v1/admin/users/${otherId}/delete_unconfirmed`)).statusCode,
    ).toBe(200);
    expect(await userRow(other.user.email)).toBeUndefined();
  });

  it('sends a password reset link and clears a lost second factor', async () => {
    const admin = await signUpAdmin();
    const member = await signUp();
    const id = (await userRow(member.user.email))?.id ?? '';
    await app
      .ctx()
      .db.update(schema.users)
      .set({ totpSecret: 'secret', totpEnabledAt: new Date() })
      .where(eq(schema.users.id, id));

    const sent = testMailer.sent.length;
    expect((await admin.client.post(`/api/v1/admin/users/${id}/password_reset`)).statusCode).toBe(
      200,
    );
    expect(testMailer.sent.slice(sent)[0]?.to).toBe(member.user.email);
    expect(testMailer.sent.slice(sent)[0]?.text).toContain('/reset-password?token=');

    expect((await admin.client.get(`/api/v1/admin/users/${id}`)).json().totp).toBe(true);
    expect((await admin.client.post(`/api/v1/admin/users/${id}/reset_two_factor`)).statusCode).toBe(
      200,
    );
    const detail = (await admin.client.get(`/api/v1/admin/users/${id}`)).json();
    expect(detail.totp).toBe(false);
    expect(detail.log.map((entry: { action: string }) => entry.action)).toEqual([
      'reset_two_factor',
      'send_password_reset',
    ]);
  });

  it('is for administrators only', async () => {
    await signUp();
    const user = await signUp();
    const id = (await userRow(user.user.email))?.id ?? '';
    expect((await user.client.get(`/api/v1/admin/users/${id}`)).statusCode).toBe(403);
    expect(
      (await user.client.patch(`/api/v1/admin/users/${id}`, { locale: 'it' })).statusCode,
    ).toBe(403);
    expect((await user.client.post(`/api/v1/admin/users/${id}/confirm_email`)).statusCode).toBe(
      403,
    );
  });
});
