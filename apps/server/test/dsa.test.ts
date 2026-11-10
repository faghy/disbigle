import { describe, expect, it } from 'vitest';
import { Client, newUser, testMailer, useTestApp } from './helpers.ts';

const app = useTestApp();

/** The latest email to this address. */
const mailTo = (address: string) => testMailer.sent.filter((m) => m.to === address).at(-1);

describe('Digital Services Act: notices and statements of reasons', () => {
  it('takes notices from anyone, removes posts with reasons and tells everyone concerned', async () => {
    const admin = new Client(app);
    await admin.post('/api/v1/auth/register', newUser());
    const author = new Client(app);
    const authorUser = newUser();
    await author.post('/api/v1/auth/register', authorUser);
    const post = (await author.post('/api/v1/statuses', { content: 'something illegal' })).json();

    // A notice from someone without an account: good faith is required, the address must be ours.
    const anyone = new Client(app);
    const notice = {
      url: `https://disbigle.test/@${authorUser.username}/${post.id}`,
      category: 'illegal',
      explanation: 'This post breaks the law because of X.',
      email: 'notifier@example.org',
      locale: 'en',
    };
    expect((await anyone.post('/api/v1/notices', notice)).statusCode).toBe(400);
    const missing = await anyone.post('/api/v1/notices', {
      ...notice,
      url: 'https://disbigle.test/@nobody-here',
      goodFaith: true,
    });
    expect(missing.statusCode).toBe(404);
    const sent = await anyone.post('/api/v1/notices', { ...notice, goodFaith: true });
    expect(sent.statusCode).toBe(201);
    expect(mailTo('notifier@example.org')?.subject).toBe('We received your report');

    const [report] = (await admin.get('/api/v1/admin/reports')).json();
    expect(report).toMatchObject({
      source: 'public',
      category: 'illegal',
      notifierEmail: 'notifier@example.org',
      contentUrl: notice.url,
      statusIds: [post.id],
      reporter: null,
      target: { username: authorUser.username },
    });

    // Only moderators remove posts this way.
    expect(
      (
        await author.post(`/api/v1/admin/statuses/${post.id}/remove`, {
          ground: 'illegal',
          reason: 'x',
        })
      ).statusCode,
    ).toBe(403);
    const removed = await admin.post(`/api/v1/admin/statuses/${post.id}/remove`, {
      ground: 'illegal',
      reason: 'It breaks the law because of X.',
      reportId: report.id,
    });
    expect(removed.statusCode).toBe(200);
    expect((await admin.get(`/api/v1/statuses/${post.id}`)).statusCode).toBe(404);
    const statement = mailTo(authorUser.email);
    expect(statement?.subject).toBe('Some of your content was removed');
    expect(statement?.text).toContain('something illegal');
    expect(statement?.text).toContain('Ground: illegal content');
    expect(statement?.text).toContain('It breaks the law because of X.');
    expect(statement?.text).toContain('contest the decision');

    // Closing the report records the decision and tells whoever sent it.
    await admin.post(`/api/v1/admin/reports/${report.id}/resolve`, {
      decision: 'removed',
      reason: 'Removed as illegal.',
    });
    const outcome = mailTo('notifier@example.org');
    expect(outcome?.subject).toBe('Outcome of your report');
    expect(outcome?.text).toContain('the content was removed.');
    const [closed] = (await admin.get('/api/v1/admin/reports?resolved=true')).json();
    expect(closed).toMatchObject({ decision: 'removed', decisionReason: 'Removed as illegal.' });

    // A suspension also comes with its reasons.
    const account = (await author.get('/api/v1/me')).json().account;
    await admin.post(`/api/v1/admin/accounts/${account.id}/suspend`, {
      reason: 'Repeated illegal content.',
      ground: 'illegal',
    });
    const suspension = mailTo(authorUser.email);
    expect(suspension?.subject).toBe('Your account was suspended');
    expect(suspension?.text).toContain('Repeated illegal content.');
  });
});
