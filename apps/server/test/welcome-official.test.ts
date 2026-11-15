import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

async function register() {
  const client = new Client(app);
  const user = newUser();
  const response = await client.post('/api/v1/auth/register', user);
  expect(response.statusCode).toBe(201);
  return { client, user, account: response.json().user.account as { id: string } };
}

const relationship = async (who: Awaited<ReturnType<typeof register>>, id: string) =>
  (await who.client.get(`/api/v1/accounts/relationships?id=${id}`)).json()[0];

describe('an official welcome account', () => {
  it('is followed one way, greets in the newcomer language, and is added to earlier members', async () => {
    const admin = await register(); // the first account is the administrator
    const earlier = await register(); // joined before the welcome account was chosen
    const official = await register();

    const saved = await admin.client.put('/api/v1/admin/settings', {
      welcomeAccount: official.user.username,
      welcomeFollowBack: false,
      welcomeMessage: 'Welcome to Disbigle!',
      welcomeMessages: { es: '¡Bienvenido a Disbigle!' },
    });
    expect(saved.json()).toMatchObject({
      welcomeFollowBack: false,
      welcomeMessages: { es: '¡Bienvenido a Disbigle!' },
    });

    // A newcomer in Spanish follows the official account, which does not follow back.
    const client = new Client(app);
    const user = newUser();
    const created = await client.post('/api/v1/auth/register', { ...user, locale: 'es' });
    expect(created.statusCode).toBe(201);
    const newcomer = { client, user, account: created.json().user.account as { id: string } };
    expect(await relationship(newcomer, official.account.id)).toMatchObject({
      following: true,
      followedBy: false,
    });
    const conversations = JSON.stringify(
      (await newcomer.client.get('/api/v1/timelines/conversations')).json(),
    );
    expect(conversations).toContain('¡Bienvenido a Disbigle!');
    expect(conversations).not.toContain('Welcome to Disbigle!');

    // Earlier members start following it too, once, on the administrator's request.
    expect((await relationship(earlier, official.account.id)).following).toBe(false);
    const first = (await admin.client.post('/api/v1/admin/welcome/follow_all')).json();
    expect(first.added).toBeGreaterThanOrEqual(2); // the admin and the earlier member
    expect(await relationship(earlier, official.account.id)).toMatchObject({
      following: true,
      followedBy: false,
    });
    expect((await admin.client.post('/api/v1/admin/welcome/follow_all')).json().added).toBe(0);
    expect((await earlier.client.post('/api/v1/admin/welcome/follow_all')).statusCode).toBe(403);
  });
});
