import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AdminDashboard, AdminUser } from '../../api/admin.ts';
import { withRole } from '../../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../../test/utils.tsx';

const days = (counts: number[]) =>
  counts.map((count, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, count }));

const dashboard: AdminDashboard = {
  users: {
    total: 42,
    pending: 2,
    suspended: 1,
    active: { day: 5, week: 17, month: 30 },
    new: { week: 3, month: 9 },
  },
  content: { localPosts: 1200, remotePosts: 8000, groups: 4 },
  federation: { remoteAccounts: 900, instances: 120, remoteFollowers: 300, remoteFollowing: 250 },
  daily: {
    signups: days([0, 1, 3, 0, 2]),
    localPosts: days([10, 12, 8, 30, 14]),
    remotePosts: days([100, 90, 120, 80, 110]),
  },
  traffic: {
    counting: true,
    daily: {
      received: days([400, 500, 450, 600, 520]),
      rejected: days([1, 0, 2, 0, 3]),
      failed: days([0, 4, 0, 0, 1]),
    },
    servers: [
      { domain: 'mastodon.social', received: 1800, rejected: 2, failedDeliveries: 0 },
      { domain: 'diaspo.it', received: 300, rejected: 0, failedDeliveries: 5 },
    ],
  },
  server: {
    host: {
      cpus: 4,
      load: [0.5, 0.7, 0.6],
      memoryTotal: 8 * 1024 ** 3,
      memoryFree: 0.4 * 1024 ** 3,
      uptimeSeconds: 900_000,
    },
    process: {
      rss: 300 * 1024 ** 2,
      heapUsed: 120 * 1024 ** 2,
      uptimeSeconds: 7200,
      node: 'v22.20.0',
    },
    disk: { total: 100 * 1024 ** 3, free: 60 * 1024 ** 3 },
    databaseBytes: 512 * 1024 ** 2,
    redisBytes: 20 * 1024 ** 2,
    queues: {
      activitypub: { waiting: 3, retrying: 1 },
      diaspora: { waiting: 0, retrying: 0, failed: 2 },
    },
  },
  generatedAt: '2026-10-30T10:00:00.000Z',
};

const carol: AdminUser = {
  userId: 'u-carol',
  actorId: 'a-carol',
  username: 'carol',
  displayName: 'Carol',
  avatarUrl: null,
  email: 'carol@example.com',
  role: 'user',
  approved: true,
  locale: 'en',
  createdAt: '2026-10-01T10:00:00.000Z',
  lastSignInAt: '2026-10-29T10:00:00.000Z',
  lastActiveAt: '2026-10-29T10:00:00.000Z',
  lastIp: '203.0.113.7',
  posts: 12,
  followers: 3,
  following: 5,
  twoFactor: true,
  suspended: false,
  disabled: false,
  deletionRequested: false,
};

describe('admin dashboard', () => {
  it('opens on the overview for administrators', async () => {
    mockApi({
      'GET /me': { body: withRole('admin') },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 2, openReports: 0 } },
      'GET /admin/dashboard': { body: dashboard },
      'GET /admin/users': { body: [carol] },
    });
    const { router } = renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/dashboard');
    // The number of people opens the full list.
    expect(screen.getByRole('link', { name: /People signed up\s*42/ })).toHaveAttribute(
      'href',
      '/admin/users',
    );
    expect(screen.getByRole('link', { name: '2 waiting' })).toHaveAttribute(
      'href',
      '/admin/pending',
    );
    expect(screen.getByRole('img', { name: /New sign-ups: bar chart, 6 in the last 5 days/ }));
    const servers = screen.getByRole('table', { name: 'Busiest servers in the last 7 days' });
    expect(within(servers).getByRole('rowheader', { name: 'diaspo.it' })).toBeInTheDocument();
    // 95% of the memory is in use: said in words, not only in red.
    expect(screen.getByText('Almost full')).toBeInTheDocument();
    expect(screen.getByText('The machine is running smoothly')).toBeInTheDocument();
    // The newest people are on the overview too, with their email.
    const latest = await screen.findByRole('list', { name: 'Latest sign-ups' });
    expect(within(latest).getByRole('link', { name: 'carol@example.com' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See everyone (1)' })).toHaveAttribute(
      'href',
      '/admin/users',
    );
  });

  it('lists people with their email for administrators', async () => {
    mockApi({
      'GET /me': { body: withRole('admin') },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 0, openReports: 0 } },
      'GET /admin/users': { body: [carol] },
    });
    renderApp('/admin/users');
    const table = await screen.findByRole('list', { name: 'People' });
    expect(within(table).getByRole('link', { name: 'carol@example.com' })).toHaveAttribute(
      'href',
      'mailto:carol@example.com',
    );
    expect(within(table).getByText('203.0.113.7')).toBeInTheDocument();
    expect(within(table).getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled();
  });

  it('keeps moderators out of the overview and the people list', async () => {
    const fetchMock = mockApi({
      'GET /me': { body: withRole('moderator') },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 0, openReports: 0 } },
      'GET /admin/pending': { body: [] },
    });
    const { router } = renderApp('/admin/users');
    await screen.findByRole('navigation', { name: /Moderation sections/ });
    expect(router.state.location.pathname).toBe('/admin/pending');
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/admin/users'))).toBe(false);
  });
});
