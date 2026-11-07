import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

describe('signing up to bring an account', () => {
  it('keeps the old address, only with the agreement about moving', async () => {
    const refused = await new Client(app).post('/api/v1/auth/register', {
      ...newUser(),
      moveFrom: 'anna@mastodon.example',
    });
    expect(refused.statusCode).toBe(422);

    const client = new Client(app);
    const created = await client.post('/api/v1/auth/register', {
      ...newUser(),
      moveFrom: '@anna@mastodon.example',
      moveAgreement: true,
    });
    expect(created.statusCode).toBe(201);
    expect((await client.get('/api/v1/me')).json()).toMatchObject({
      moveFrom: 'anna@mastodon.example',
      aliases: [],
    });

    const plain = new Client(app);
    await plain.post('/api/v1/auth/register', newUser());
    expect((await plain.get('/api/v1/me')).json()).toMatchObject({ moveFrom: null });
  });
});
