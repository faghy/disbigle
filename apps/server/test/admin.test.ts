import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp({ REGISTRATION_MODE: 'approval' });

async function register(client: Client) {
  const user = newUser();
  const response = await client.post('/api/v1/auth/register', { ...user, reason: 'I run a pod' });
  return { user, response };
}

describe('moderation', () => {
  it('lets the admin approve pending registrations, suspend accounts and handle reports', async () => {
    const admin = new Client(app);
    const first = await register(admin);
    expect(first.response.statusCode).toBe(201); // first user is admin and approved

    const pendingClient = new Client(app);
    const pending = await register(pendingClient);
    expect(pending.response.statusCode).toBe(202);
    const login = await pendingClient.post('/api/v1/auth/login', {
      login: pending.user.username,
      password: pending.user.password,
    });
    expect(login.json().error).toBe('account_pending_approval');

    expect((await admin.get('/api/v1/admin/summary')).json()).toEqual({
      pendingUsers: 1,
      openReports: 0,
    });
    const queue = (await admin.get('/api/v1/admin/pending')).json();
    expect(queue[0]).toMatchObject({
      reason: 'I run a pod',
      account: { username: pending.user.username },
    });
    await admin.post(`/api/v1/admin/pending/${queue[0].userId}/approve`);
    expect(
      (
        await pendingClient.post('/api/v1/auth/login', {
          login: pending.user.username,
          password: pending.user.password,
        })
      ).json().status,
    ).toBe('ok');

    // Regular users cannot use the admin API.
    expect((await pendingClient.get('/api/v1/admin/pending')).statusCode).toBe(403);

    // A report from the new user about the admin's post is not allowed to target oneself, but works for others.
    const adminAccount = first.response.json().user.account;
    const post = (await admin.post('/api/v1/statuses', { content: 'spam spam' })).json();
    const report = await pendingClient.post('/api/v1/reports', {
      accountId: adminAccount.id,
      statusIds: [post.id],
      category: 'spam',
    });
    expect(report.statusCode).toBe(201);
    const reports = (await admin.get('/api/v1/admin/reports')).json();
    expect(reports[0]).toMatchObject({
      category: 'spam',
      statusIds: [post.id],
      target: { id: adminAccount.id },
    });
    await admin.post(`/api/v1/admin/reports/${reports[0].id}/resolve`);
    expect((await admin.get('/api/v1/admin/reports')).json()).toEqual([]);

    // Suspending signs the user out and hides the profile; admins cannot be suspended.
    const userAccount = (await pendingClient.get('/api/v1/me')).json().account;
    await admin.post(`/api/v1/admin/accounts/${userAccount.id}/suspend`, { reason: 'test' });
    expect((await pendingClient.get('/api/v1/me')).statusCode).toBe(401);
    expect((await admin.get(`/api/v1/accounts/${userAccount.id}`)).statusCode).toBe(404);
    expect(
      (await admin.post(`/api/v1/admin/accounts/${adminAccount.id}/suspend`, {})).statusCode,
    ).toBe(400);
    await admin.post(`/api/v1/admin/accounts/${userAccount.id}/unsuspend`);
    expect((await admin.get(`/api/v1/accounts/${userAccount.id}`)).statusCode).toBe(200);

    // Domain blocks (admins only). The unsuspended user signs in again first.
    await pendingClient.post('/api/v1/auth/login', {
      login: pending.user.username,
      password: pending.user.password,
    });

    // Instance settings (admins only) apply at once.
    expect((await pendingClient.get('/api/v1/admin/settings')).statusCode).toBe(403);
    const settings = await admin.request('PUT', '/api/v1/admin/settings', {
      title: 'Diaspoverso',
      rules: ['Sii gentile', 'Niente spam'],
      registrationMode: 'closed',
    });
    expect(settings.json()).toMatchObject({ title: 'Diaspoverso', registrationMode: 'closed' });
    expect((await new Client(app).get('/api/v1/instance')).json()).toMatchObject({
      title: 'Diaspoverso',
      rules: ['Sii gentile', 'Niente spam'],
      registrationMode: 'closed',
    });
    const refused = await new Client(app).post('/api/v1/auth/register', {
      ...newUser(),
      reason: 'x',
    });
    expect(refused.json().error).toBe('registrations_closed');
    await admin.request('PUT', '/api/v1/admin/settings', { registrationMode: 'approval' });

    expect(
      (
        await pendingClient.post('/api/v1/admin/domain_blocks', {
          domain: 'spam.example',
          severity: 'suspend',
        })
      ).statusCode,
    ).toBe(403);
    const created = await admin.post('/api/v1/admin/domain_blocks', {
      domain: 'https://Spam.Example/',
      severity: 'suspend',
      publicComment: 'spam',
    });
    expect(created.statusCode).toBe(201);
    expect((await admin.get('/api/v1/admin/domain_blocks')).json()).toEqual([
      expect.objectContaining({ domain: 'spam.example', severity: 'suspend' }),
    ]);
    expect((await admin.delete('/api/v1/admin/domain_blocks/spam.example')).statusCode).toBe(200);
    expect((await admin.get('/api/v1/admin/domain_blocks')).json()).toEqual([]);
  });
});
