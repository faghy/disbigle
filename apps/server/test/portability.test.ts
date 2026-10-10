import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

describe('account portability', () => {
  it('exports the account data without secrets', async () => {
    const client = new Client(app);
    const user = newUser();
    await client.post('/api/v1/auth/register', user);
    const aspects = (await client.get('/api/v1/aspects')).json();
    await client.post('/api/v1/statuses', { content: 'primo post #ciao' });
    const response = await client.get('/api/v1/me/export');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="disbigle-.+\.json"/,
    );
    const data = response.json();
    expect(data).toMatchObject({
      format: 'disbigle-export',
      version: 1,
      account: { email: user.email },
    });
    expect(data.posts[0]).toMatchObject({ markdown: 'primo post #ciao', visibility: 'public' });
    expect(data.aspects.map((a: { name: string }) => a.name)).toEqual(
      aspects.map((a: { name: string }) => a.name),
    );
    expect(response.body).not.toContain('PRIVATE KEY');
    expect(response.body).not.toContain('$argon2');
  });

  it('deletes the account after confirming the password', async () => {
    const client = new Client(app);
    await new Client(app).post('/api/v1/auth/register', newUser()); // keep another admin-free user around
    const user = newUser();
    await client.post('/api/v1/auth/register', user);
    const me = (await client.get('/api/v1/me')).json();
    expect((await client.post('/api/v1/me/delete', { password: 'wrong' })).statusCode).toBe(403);
    expect((await client.post('/api/v1/me/delete', { password: user.password })).statusCode).toBe(
      200,
    );
    expect((await client.get('/api/v1/me')).statusCode).toBe(401);
    expect((await new Client(app).get(`/api/v1/accounts/${me.account.id}`)).statusCode).toBe(404);
    const login = await new Client(app).post('/api/v1/auth/login', {
      login: user.username,
      password: user.password,
    });
    expect(login.json().error).toBe('account_disabled');
  });
});

describe('password reset', () => {
  it('emails a one-time link that sets a new password and signs out other sessions', async () => {
    const { testMailer } = await import('./helpers.ts');
    const client = new Client(app);
    const user = newUser();
    await client.post('/api/v1/auth/register', user);

    // Unknown addresses get the same answer and no email.
    const before = testMailer.sent.length;
    expect(
      (await new Client(app).post('/api/v1/auth/password/forgot', { email: 'nobody@example.com' }))
        .statusCode,
    ).toBe(200);
    expect(testMailer.sent.length).toBe(before);

    await new Client(app).post('/api/v1/auth/password/forgot', { email: user.email.toUpperCase() });
    const mail = testMailer.sent.at(-1);
    expect(mail?.to).toBe(user.email);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail?.text ?? '')?.[1] ?? '');
    expect(token.length).toBeGreaterThan(20);

    const reset = await new Client(app).post('/api/v1/auth/password/reset', {
      token,
      password: 'a completely new one',
    });
    expect(reset.statusCode).toBe(200);
    expect((await client.get('/api/v1/me')).statusCode).toBe(401);
    const again = await new Client(app).post('/api/v1/auth/password/reset', {
      token,
      password: 'another new password',
    });
    expect(again.statusCode).toBe(400);
    const login = await new Client(app).post('/api/v1/auth/login', {
      login: user.username,
      password: 'a completely new one',
    });
    expect(login.json().status).toBe('ok');
  });
});
