import { generate } from 'otplib';
import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

describe('public endpoints', () => {
  it('reports health and instance info', async () => {
    const client = new Client(app);
    expect((await client.get('/health')).json()).toEqual({ status: 'ok' });
    expect((await client.get('/api/v1/instance')).json()).toMatchObject({
      domain: 'disbigle.test',
      registrationMode: 'open',
    });
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const response = await new Client(app).get('/api/v1/nope');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'not_found' });
  });
});

describe('registration and sign-in', () => {
  it('registers, signs in automatically and returns the current user', async () => {
    const client = new Client(app);
    const user = newUser();
    const registered = await client.post('/api/v1/auth/register', user);
    expect(registered.statusCode).toBe(201);
    expect(registered.json().user.account.username).toBe(user.username);

    const me = await client.get('/api/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: user.email, totpEnabled: false, passkeyCount: 0 });
  });

  it('validates registration input', async () => {
    const response = await new Client(app).post('/api/v1/auth/register', {
      username: 'not valid!',
      email: 'x',
      password: 'short',
    });
    expect(response.statusCode).toBe(422);
    const paths = response.json().details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['username', 'email', 'password', 'agreement']));
  });

  it('rejects a taken username with 409', async () => {
    const user = newUser();
    await new Client(app).post('/api/v1/auth/register', user);
    const again = await new Client(app).post('/api/v1/auth/register', {
      ...newUser(),
      username: user.username,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('username_taken');
  });

  it('signs in, signs out and refuses access afterwards', async () => {
    const user = newUser();
    await new Client(app).post('/api/v1/auth/register', user);
    const client = new Client(app);
    expect((await client.get('/api/v1/me')).statusCode).toBe(401);
    const loginResponse = await client.post('/api/v1/auth/login', {
      login: user.email,
      password: user.password,
    });
    expect(loginResponse.json()).toMatchObject({ status: 'ok' });
    expect(loginResponse.cookies[0]).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
    });
    expect((await client.get('/api/v1/me')).statusCode).toBe(200);
    await client.post('/api/v1/auth/logout');
    expect((await client.get('/api/v1/me')).statusCode).toBe(401);
  });

  it('rejects cross-origin writes made with the session cookie', async () => {
    const client = new Client(app);
    const user = newUser();
    const registered = await client.post('/api/v1/auth/register', user);
    const cookie = registered.cookies.find((c) => c.name === 'disbigle_session');
    const response = await app().inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      payload: { displayName: 'pwned' },
      headers: { cookie: `disbigle_session=${cookie?.value}`, origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('account settings', () => {
  it('updates the profile', async () => {
    const client = new Client(app);
    await client.post('/api/v1/auth/register', newUser());
    const response = await client.patch('/api/v1/me/profile', {
      displayName: 'Disbiglio',
      note: 'Ciao',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ displayName: 'Disbiglio', note: 'Ciao' });
  });

  it('changes the interface language', async () => {
    const client = new Client(app);
    await client.post('/api/v1/auth/register', newUser());
    expect((await client.patch('/api/v1/me/settings', { locale: 'it' })).json().locale).toBe('it');
    expect((await client.patch('/api/v1/me/settings', { locale: 'xx' })).statusCode).toBe(422);
  });

  it('enables TOTP and then requires it at sign-in', async () => {
    const user = newUser();
    const client = new Client(app);
    await client.post('/api/v1/auth/register', user);
    const setup = (await client.post('/api/v1/me/totp/setup')).json();
    const confirm = await client.post('/api/v1/me/totp/confirm', {
      code: await generate({ secret: setup.secret }),
    });
    expect(confirm.json().codes).toHaveLength(10);

    const other = new Client(app);
    const first = await other.post('/api/v1/auth/login', {
      login: user.username,
      password: user.password,
    });
    expect(first.json()).toMatchObject({
      status: 'mfa_required',
      methods: ['totp', 'recovery_code'],
    });
    expect((await other.get('/api/v1/me')).statusCode).toBe(401);
    expect(
      (await other.post('/api/v1/auth/mfa', { code: confirm.json().codes[0] })).statusCode,
    ).toBe(200);
    expect((await other.get('/api/v1/me')).json().totpEnabled).toBe(true);
  });

  it('looks up a local account by username', async () => {
    const user = newUser();
    await new Client(app).post('/api/v1/auth/register', user);
    const response = await new Client(app).get(
      `/api/v1/accounts/lookup/${user.username.toUpperCase()}`,
    );
    expect(response.json()).toMatchObject({
      username: user.username,
      acct: user.username,
      local: true,
    });
    expect((await new Client(app).get('/api/v1/accounts/lookup/nobody')).statusCode).toBe(404);
  });
});
