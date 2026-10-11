import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

// Handles are user@disbigle.test, the app is served at https://social.disbigle.test.
const app = useTestApp({
  PUBLIC_URL: 'https://social.disbigle.test',
  LOCAL_DOMAIN: 'disbigle.test',
});

async function register() {
  const client = new Client(app);
  const response = await client.post('/api/v1/auth/register', newUser());
  expect(response.statusCode).toBe(201);
  return response.json().user.account as { username: string; acct: string };
}

async function webfinger(resource: string) {
  return app().inject({
    method: 'GET',
    url: `/.well-known/webfinger?resource=${encodeURIComponent(resource)}`,
    headers: { host: 'social.disbigle.test' },
  });
}

describe('split domain', () => {
  it('answers WebFinger for the handle domain with the app URLs and the diaspora* links', async () => {
    const account = await register();
    const response = await webfinger(`acct:${account.username}@disbigle.test`);
    expect(response.statusCode).toBe(200);
    const jrd = response.json();
    expect(jrd.subject).toBe(`acct:${account.username}@disbigle.test`);
    const self = jrd.links.find((l: { rel: string }) => l.rel === 'self');
    expect(self.href).toBe(`https://social.disbigle.test/users/${account.username}`);
    const hcard = jrd.links.find(
      (l: { rel: string }) => l.rel === 'http://microformats.org/profile/hcard',
    );
    expect(hcard.href).toMatch(/^https:\/\/social\.disbigle\.test\/hcard\/users\//);
  });

  it('resolves the web host back to the canonical handle, as Mastodon checks', async () => {
    const account = await register();
    const response = await webfinger(`acct:${account.username}@social.disbigle.test`);
    expect(response.statusCode).toBe(200);
    expect(response.json().subject).toBe(`acct:${account.username}@disbigle.test`);
  });

  it('serves the actor with ids on the web host', async () => {
    const account = await register();
    const response = await app().inject({
      method: 'GET',
      url: `/users/${account.username}`,
      headers: { host: 'social.disbigle.test', accept: 'application/activity+json' },
    });
    expect(response.statusCode).toBe(200);
    const actor = response.json();
    expect(actor.id).toBe(`https://social.disbigle.test/users/${account.username}`);
    expect(actor.inbox).toBe(`https://social.disbigle.test/users/${account.username}/inbox`);
  });
});
