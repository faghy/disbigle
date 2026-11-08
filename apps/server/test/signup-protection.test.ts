import { isDisposableEmail } from '@disbigle/core';
import { describe, expect, it } from 'vitest';
import { Client, newUser, testMailer, useTestApp } from './helpers.ts';

const app = useTestApp({ REQUIRE_EMAIL_VERIFICATION: 'true' });

const linkFor = (email: string) => {
  const mail = [...testMailer.sent].reverse().find((m) => m.to === email);
  return /token=([^\s]+)/.exec(mail?.text ?? '')?.[1];
};

describe('protecting sign-up and sign-in', () => {
  it('asks new accounts to confirm their email before signing in', async () => {
    // The first account of a server (the admin) needs no confirmation.
    await new Client(app).post('/api/v1/auth/register', newUser());

    const user = newUser();
    const client = new Client(app);
    const registered = await client.post('/api/v1/auth/register', user);
    expect(registered.statusCode).toBe(202);
    expect(registered.json()).toEqual({ status: 'pending_verification', approval: false });
    const login = { login: user.username, password: user.password };
    const refused = await client.post('/api/v1/auth/login', login);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('email_not_verified');

    // Sending it again, then the link.
    expect((await client.post('/api/v1/auth/email/resend', { login: user.email })).statusCode).toBe(
      200,
    );
    const token = decodeURIComponent(linkFor(user.email) ?? '');
    expect(token).not.toBe('');
    expect((await client.post('/api/v1/auth/email/verify', { token })).json()).toEqual({
      status: 'ok',
    });
    expect((await client.post('/api/v1/auth/email/verify', { token })).statusCode).toBe(400);
    expect((await client.post('/api/v1/auth/login', login)).statusCode).toBe(200);
  });

  it('refuses throwaway email addresses', async () => {
    expect(isDisposableEmail('someone@mailinator.com')).toBe(true);
    expect(isDisposableEmail('someone@sub.mailinator.com')).toBe(true);
    expect(isDisposableEmail('someone@gmail.com')).toBe(false);
    const response = await new Client(app).post('/api/v1/auth/register', {
      ...newUser(),
      email: 'bot@mailinator.com',
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().details).toEqual([expect.objectContaining({ path: 'email' })]);
  });

  it('slows down wrong passwords on one account and tells its owner', async () => {
    const user = newUser();
    const client = new Client(app);
    await client.post('/api/v1/auth/register', user);
    const token = decodeURIComponent(linkFor(user.email) ?? '');
    await client.post('/api/v1/auth/email/verify', { token });
    const before = testMailer.sent.length;
    for (let i = 0; i < 5; i++) {
      const wrong = await new Client(app).post('/api/v1/auth/login', {
        login: user.username,
        password: 'not the right one',
      });
      expect(wrong.statusCode).toBe(401);
    }
    // Locked now, even with the right password; the owner got one email.
    const locked = await new Client(app).post('/api/v1/auth/login', {
      login: user.username,
      password: user.password,
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe('too_many_attempts');
    const warnings = testMailer.sent.slice(before).filter((m) => m.to === user.email);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.subject).toMatch(/password/i);
  });
});
