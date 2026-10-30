import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

async function signUp() {
  const client = new Client(app);
  const user = newUser();
  const response = await client.post('/api/v1/auth/register', user);
  expect(response.statusCode).toBe(201);
  return { client, user };
}

describe('admin dashboard', () => {
  it('shows administrators people, numbers, federation traffic and the server', async () => {
    const admin = await signUp(); // the first account is the administrator
    const member = await signUp();
    await member.client.post('/api/v1/statuses', { content: 'Hello' });

    // A delivery with a signature we cannot verify: counted, and counted as refused.
    const delivery = await app().inject({
      method: 'POST',
      url: '/inbox',
      headers: {
        'content-type': 'application/activity+json',
        signature:
          'keyId="https://mastodon.example/users/sam#main-key",algorithm="rsa-sha256",headers="(request-target) host date",signature="AAAA"',
      },
      payload: JSON.stringify({ type: 'Create', actor: 'https://mastodon.example/users/sam' }),
    });
    expect(delivery.statusCode).toBeGreaterThanOrEqual(400);

    const dashboard = (await admin.client.get('/api/v1/admin/dashboard')).json();
    expect(dashboard.users).toMatchObject({
      total: 2,
      pending: 0,
      new: { week: 2, month: 2 },
      active: { day: 2 },
    });
    expect(dashboard.content.localPosts).toBeGreaterThanOrEqual(1);
    expect(dashboard.daily.signups).toHaveLength(30);
    expect(dashboard.daily.signups.at(-1).count).toBe(2);
    expect(dashboard.traffic.counting).toBe(true);
    expect(dashboard.traffic.servers).toContainEqual({
      domain: 'mastodon.example',
      received: 1,
      rejected: 1,
      failedDeliveries: 0,
    });
    expect(dashboard.traffic.daily.received.at(-1).count).toBe(1);
    expect(dashboard.server.host.cpus).toBeGreaterThan(0);
    expect(dashboard.server.databaseBytes).toBeGreaterThan(0);

    const users = (await admin.client.get('/api/v1/admin/users')).json();
    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({
      username: member.user.username,
      email: member.user.email,
      role: 'user',
      posts: 1,
      twoFactor: false,
      suspended: false,
    });
    expect(users[0].lastActiveAt).not.toBeNull();
    const found = (await admin.client.get(`/api/v1/admin/users?q=${member.user.email}`)).json();
    expect(found.map((u: { username: string }) => u.username)).toEqual([member.user.username]);
  });

  it('is for administrators only', async () => {
    const user = await signUp();
    expect((await user.client.get('/api/v1/admin/dashboard')).statusCode).toBe(403);
    expect((await user.client.get('/api/v1/admin/users')).statusCode).toBe(403);
  });
});
