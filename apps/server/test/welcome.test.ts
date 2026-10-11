import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp({ REGISTRATION_MODE: 'approval' });

describe('welcome for new accounts', () => {
  it('connects newcomers to the welcome account, in its aspect, with a private message', async () => {
    const admin = new Client(app);
    const adminUser = newUser();
    const first = await admin.post('/api/v1/auth/register', adminUser);
    expect(first.statusCode).toBe(201);
    const adminAccount = first.json().user.account as { id: string; username: string };
    const aspect = (await admin.post('/api/v1/aspects', { name: 'Fediverso' })).json();
    const saved = await admin.put('/api/v1/admin/settings', {
      welcomeAccount: adminAccount.username,
      welcomeAspect: 'fediverso',
      welcomeMessage: 'Benvenuto nel fediverso🚀\nCiao!\n\nWelcome to the fediverse🚀',
    });
    expect(saved.json()).toMatchObject({
      welcomeAccount: adminAccount.username,
      welcomeAspect: 'fediverso',
    });

    // An approval-mode sign-up is welcomed when the admin approves it, not before.
    const newcomer = new Client(app);
    const user = newUser();
    expect(
      (await newcomer.post('/api/v1/auth/register', { ...user, reason: 'hi' })).statusCode,
    ).toBe(202);
    expect((await admin.get(`/api/v1/aspects/${aspect.id}/members`)).json()).toHaveLength(0);
    const [pending] = (await admin.get('/api/v1/admin/pending')).json();
    await admin.post(`/api/v1/admin/pending/${pending.userId}/approve`);

    const members = (await admin.get(`/api/v1/aspects/${aspect.id}/members`)).json();
    expect(members.map((m: { username: string }) => m.username)).toEqual([user.username]);

    await newcomer.post('/api/v1/auth/login', { login: user.username, password: user.password });
    const [relationship] = (
      await newcomer.get(`/api/v1/accounts/relationships?id=${adminAccount.id}`)
    ).json();
    expect(relationship).toMatchObject({ following: true, followedBy: true });

    const conversations = (await newcomer.get('/api/v1/timelines/conversations')).json();
    expect(JSON.stringify(conversations)).toContain('Benvenuto nel fediverso');
  });
});
